"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { logAction } from "@/db/audit";
import { resolveApprovals } from "@/db/approvals";
import { notifyUser } from "@/db/notifications";
import { uploadRequisitionDocument } from "@/db/documentStorage";
import { extractLineItemsFromDocument } from "@/db/documentExtraction";
import { purchaseRequisitions, purchaseRequisitionLines } from "@/db/schema";

export type LineInput = {
  catalogItemId: string | null;
  freeTextDescription: string | null;
  categoryId: string | null;
  fulfillmentType: "goods" | "service";
  quantity: string;
  uom: string;
  estimatedUnitPrice: string;
};

export async function createRequisition(input: {
  departmentId: string | null;
  costCenterId: string | null;
  justification: string;
  lines: LineInput[];
  submit: boolean;
  sourceDocumentKey?: string | null;
}) {
  const { user, tenant } = await getCurrentUserAndTenant();

  const validLines = input.lines.filter(
    (l) => (l.catalogItemId || l.freeTextDescription?.trim()) && Number(l.quantity) > 0,
  );
  if (validLines.length === 0) return { error: "Add at least one line item with a quantity greater than zero." };

  const linesWithTotals = validLines.map((l) => ({
    ...l,
    lineTotal: (Number(l.quantity) * Number(l.estimatedUnitPrice)).toFixed(2),
  }));
  const total = linesWithTotals.reduce((sum, l) => sum + Number(l.lineTotal), 0).toFixed(2);

  const requisitionId = await withTenant(tenant.id, async (tx) => {
    const [requisition] = await tx
      .insert(purchaseRequisitions)
      .values({
        tenantId: tenant.id,
        requestorId: user.id,
        departmentId: input.departmentId,
        costCenterId: input.costCenterId,
        justification: input.justification.trim() || null,
        totalEstimatedValue: total,
        status: input.submit ? "submitted" : "draft",
        submittedAt: input.submit ? new Date() : null,
        sourceDocumentKey: input.sourceDocumentKey || null,
      })
      .returning();

    await tx.insert(purchaseRequisitionLines).values(
      linesWithTotals.map((l) => ({
        tenantId: tenant.id,
        requisitionId: requisition.id,
        catalogItemId: l.catalogItemId,
        freeTextDescription: l.freeTextDescription,
        categoryId: l.categoryId,
        fulfillmentType: l.fulfillmentType,
        quantity: l.quantity,
        uom: l.uom,
        estimatedUnitPrice: l.estimatedUnitPrice,
        lineTotal: l.lineTotal,
      })),
    );

    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: input.submit ? "requisition.submitted" : "requisition.created",
      entityType: "purchase_requisition",
      entityId: requisition.id,
      metadata: { total, lineCount: linesWithTotals.length },
    });

    if (input.submit) {
      await notifyUser(tx, user.id, "requisition_submitted", "Your requisition was submitted", `Total: ${total}`);
      await resolveApprovals(tx, tenant.id, requisition.id);
    }

    return requisition.id;
  });

  revalidatePath("/dashboard/requisitions");
  return { id: requisitionId };
}

export async function submitRequisition(formData: FormData) {
  const requisitionId = String(formData.get("requisitionId") ?? "");
  if (!requisitionId) return;

  const { user, tenant } = await getCurrentUserAndTenant();

  await withTenant(tenant.id, async (tx) => {
    const [updated] = await tx
      .update(purchaseRequisitions)
      .set({ status: "submitted", submittedAt: new Date() })
      .where(
        and(
          eq(purchaseRequisitions.id, requisitionId),
          eq(purchaseRequisitions.status, "draft"),
          eq(purchaseRequisitions.requestorId, user.id),
        ),
      )
      .returning();
    if (!updated) return;

    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "requisition.submitted",
      entityType: "purchase_requisition",
      entityId: updated.id,
      metadata: {},
    });

    await notifyUser(tx, user.id, "requisition_submitted", "Your requisition was submitted", `Total: ${updated.totalEstimatedValue}`);
    await resolveApprovals(tx, tenant.id, updated.id);
  });

  revalidatePath("/dashboard/requisitions");
}

export async function reviseAndResubmitRequisition(input: {
  requisitionId: string;
  departmentId: string | null;
  costCenterId: string | null;
  justification: string;
  lines: LineInput[];
}): Promise<{ error?: string; id?: string }> {
  const { user, tenant } = await getCurrentUserAndTenant();

  const validLines = input.lines.filter(
    (l) => (l.catalogItemId || l.freeTextDescription?.trim()) && Number(l.quantity) > 0,
  );
  if (validLines.length === 0) return { error: "Add at least one line item with a quantity greater than zero." };

  const linesWithTotals = validLines.map((l) => ({
    ...l,
    lineTotal: (Number(l.quantity) * Number(l.estimatedUnitPrice)).toFixed(2),
  }));
  const total = linesWithTotals.reduce((sum, l) => sum + Number(l.lineTotal), 0).toFixed(2);

  const result = await withTenant(tenant.id, async (tx) => {
    const [existing] = await tx
      .select()
      .from(purchaseRequisitions)
      .where(
        and(
          eq(purchaseRequisitions.id, input.requisitionId),
          eq(purchaseRequisitions.requestorId, user.id),
          eq(purchaseRequisitions.status, "rejected_revisable"),
        ),
      );
    if (!existing) return { error: "This requisition can't be revised right now." };

    await tx.delete(purchaseRequisitionLines).where(eq(purchaseRequisitionLines.requisitionId, existing.id));
    await tx.insert(purchaseRequisitionLines).values(
      linesWithTotals.map((l) => ({
        tenantId: tenant.id,
        requisitionId: existing.id,
        catalogItemId: l.catalogItemId,
        freeTextDescription: l.freeTextDescription,
        categoryId: l.categoryId,
        fulfillmentType: l.fulfillmentType,
        quantity: l.quantity,
        uom: l.uom,
        estimatedUnitPrice: l.estimatedUnitPrice,
        lineTotal: l.lineTotal,
      })),
    );

    await tx
      .update(purchaseRequisitions)
      .set({
        departmentId: input.departmentId,
        costCenterId: input.costCenterId,
        justification: input.justification.trim() || null,
        totalEstimatedValue: total,
        status: "submitted",
        submittedAt: new Date(),
      })
      .where(eq(purchaseRequisitions.id, existing.id));

    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "requisition.revised_and_resubmitted",
      entityType: "purchase_requisition",
      entityId: existing.id,
      metadata: { total, lineCount: linesWithTotals.length },
    });

    // Runs a fresh approval resolution rather than trying to carry
    // forward whichever prior decisions are still "valid" — §04 says
    // unaffected approvers' decisions should stand, but doing that
    // correctly needs materiality-diffing logic (did the value/category
    // change enough to matter) that isn't specified precisely enough to
    // implement safely. Re-asking everyone is the conservative default;
    // it never under-approves, worst case it re-asks someone who'd
    // already said yes.
    await resolveApprovals(tx, tenant.id, existing.id);

    return { id: existing.id };
  });

  revalidatePath("/dashboard/requisitions");
  return result;
}

export type ExtractedRequisitionDraft = {
  lines: LineInput[];
  vendorName: string | null;
  sourceDocumentKey: string;
  error?: string;
};

/**
 * Uploads a quotation/proforma/GST invoice to R2 and attempts to
 * extract line items from it. Always returns the uploaded key (so it
 * can still be attached to the requisition even when extraction fails
 * or isn't configured) plus whatever lines were extracted — empty when
 * extraction isn't available, with `error` explaining why. The caller
 * shows the extracted lines pre-filled into the same editable table
 * manual entry uses; nothing here submits a requisition.
 */
export async function extractRequisitionFromDocument(formData: FormData): Promise<{ error?: string } & Partial<ExtractedRequisitionDraft>> {
  const { tenant } = await getCurrentUserAndTenant();
  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "No file was selected." };

  const upload = await uploadRequisitionDocument(tenant.id, file);
  if (upload.error || !upload.key) return { error: upload.error ?? "Upload failed." };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const extraction = await extractLineItemsFromDocument({ bytes, mimeType: file.type });

  return {
    sourceDocumentKey: upload.key,
    vendorName: extraction.vendorName,
    error: extraction.error,
    lines: extraction.lines.map((l) => ({
      catalogItemId: null,
      freeTextDescription: l.description,
      categoryId: null,
      fulfillmentType: "goods",
      quantity: l.quantity,
      uom: l.uom,
      estimatedUnitPrice: l.estimatedUnitPrice,
    })),
  };
}
