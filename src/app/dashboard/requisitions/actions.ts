"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { previewApprovalChain, type ApprovalPreview } from "@/db/approvalPreview";
import { logAction } from "@/db/audit";
import { resolveApprovals } from "@/db/approvals";
import { notifyUser } from "@/db/notifications";
import { getRequisitionUploadUrl, getRequisitionDocumentBytes, getRequisitionDocumentUrl } from "@/db/documentStorage";
import { extractLineItemsFromDocument, type ExtractedDocumentMeta } from "@/db/documentExtraction";
import { getItemPurchaseHistory, type ItemPurchaseHistoryEntry } from "@/db/itemHistory";
import { findSimilarCatalogItems, type SimilarCatalogItem } from "@/db/catalogMatch";
import { judgeCatalogMatch } from "@/db/catalogMatchJudge";
import { purchaseRequisitions, purchaseRequisitionLines } from "@/db/schema";

export type LineInput = {
  catalogItemId: string | null;
  freeTextDescription: string | null;
  categoryId: string | null;
  fulfillmentType: "goods" | "service";
  quantity: string;
  uom: string;
  estimatedUnitPrice: string;
  // Whether estimatedUnitPrice is a real quoted/invoiced price or a
  // requester's guess/ceiling — see db/schema.ts's priceConfirmed column.
  priceConfirmed: boolean;
};

export async function createRequisition(input: {
  departmentId: string | null;
  costCenterId: string | null;
  justification: string;
  lines: LineInput[];
  submit: boolean;
  sourceDocumentKey?: string | null;
  extractedDocumentMeta?: ExtractedDocumentMeta | null;
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
        extractedDocumentMeta: input.extractedDocumentMeta ?? {},
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
        priceConfirmed: l.priceConfirmed,
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
        priceConfirmed: l.priceConfirmed,
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
  lines: (LineInput & { matchesExistingLineIndex: number | null })[];
  documentMeta: ExtractedDocumentMeta;
  sourceDocumentKey: string;
  error?: string;
};

/**
 * Step 1 of the upload flow: returns a short-lived presigned R2 URL so
 * the browser can PUT the file directly to R2, bypassing this Server
 * Action entirely for the actual bytes. Vercel Functions cap request
 * bodies at 4.5MB regardless of Next's own serverActions.bodySizeLimit
 * — routing a real scanned document through a Server Action hits that
 * ceiling with a 413 that surfaces to the user as a garbled, page-looks-
 * broken error rather than a clear message. Only this small JSON
 * request/response crosses the action boundary.
 */
export async function getRequisitionDocumentUploadUrl(input: {
  fileName: string;
  mimeType: string;
  fileSize: number;
}): Promise<{ key?: string; uploadUrl?: string; error?: string }> {
  const { tenant } = await getCurrentUserAndTenant();
  return getRequisitionUploadUrl(tenant.id, input.fileName, input.mimeType, input.fileSize);
}

/**
 * Step 2: after the browser has PUT the file directly to R2 (see
 * getRequisitionDocumentUploadUrl above), reads it back server-side and
 * attempts to extract line items plus vendor/document/tax detail. Always
 * returns the key (so it can still be attached to the requisition even
 * when extraction fails or isn't configured) plus whatever lines were
 * extracted — empty when extraction isn't available, with `error`
 * explaining why. The caller shows the extracted lines pre-filled into
 * the same editable table manual entry uses; nothing here submits or
 * persists a requisition.
 *
 * `existingLines`, when the caller already has some lines typed (either
 * mid-wizard or attaching a document to an existing draft), is passed
 * through to the extractor so it can match new lines against them by
 * meaning rather than wording. The returned `matchesExistingLineIndex`
 * is an index into `existingLines` as given — the caller is responsible
 * for resolving it back against the exact same list it sent.
 */
export async function extractRequisitionFromDocument(input: {
  key: string;
  existingLines?: { index: number; description: string }[];
}): Promise<{ error?: string } & Partial<ExtractedRequisitionDraft>> {
  const { tenant } = await getCurrentUserAndTenant();
  if (!input.key.startsWith(`requisitions/${tenant.id}/`)) return { error: "Invalid document reference." };

  const { bytes, mimeType, error } = await getRequisitionDocumentBytes(input.key);
  if (error || !bytes) return { error };

  const extraction = await extractLineItemsFromDocument(
    { bytes, mimeType: mimeType ?? "application/octet-stream" },
    { existingLines: input.existingLines ?? [] },
  );

  return {
    sourceDocumentKey: input.key,
    documentMeta: extraction.documentMeta,
    error: extraction.error,
    lines: extraction.lines.map((l) => ({
      catalogItemId: null,
      freeTextDescription: l.description,
      categoryId: null,
      fulfillmentType: l.fulfillmentType,
      quantity: l.quantity,
      uom: l.uom,
      estimatedUnitPrice: l.estimatedUnitPrice,
      // A quotation/invoice states a real price, not a guess.
      priceConfirmed: true,
      matchesExistingLineIndex: l.matchesExistingLineIndex,
    })),
  };
}

/**
 * What this catalog item has actually cost before, so a requester setting
 * a price/ceiling has something to anchor it to instead of guessing blind.
 * Thin tenant-scoped wrapper around the same query already shown to
 * approvers (src/app/dashboard/approvals/page.tsx) — no new DB logic.
 */
export async function getCatalogItemPriceHistory(input: { catalogItemId: string }): Promise<ItemPurchaseHistoryEntry[]> {
  const { tenant } = await getCurrentUserAndTenant();
  return withTenant(tenant.id, (tx) => getItemPurchaseHistory(tx, input.catalogItemId, 3));
}

/**
 * Backs CatalogMatchHint: after someone finishes typing a free-text line
 * description, is there a catalogue item this already is? Two-stage,
 * following the split explained in db/catalogMatch.ts's docblock —
 * trigram similarity cannot decide identity on its own (measured: same-
 * item and different-item pairs overlap in score), so it's used only for
 * cheap recall here, and an LLM (db/catalogMatchJudge.ts) makes the actual
 * call by reading both descriptions for meaning.
 *
 * The judge is skipped entirely when trigram recall finds nothing — an
 * empty candidate list can't contain a match, so there's no reason to
 * spend an API call finding that out. When ANTHROPIC_API_KEY isn't
 * configured, judgeCatalogMatch returns null and this returns null too:
 * this deliberately does NOT fall back to the top trigram candidate in
 * that case, because an un-judged trigram hit is exactly the kind of
 * confidently-wrong suggestion the judge stage exists to filter out (see
 * the SKF 6205/6305 example in catalogMatch.ts). No suggestion is the
 * safe default, not "probably right".
 */
export async function suggestCatalogItemForLine(description: string): Promise<SimilarCatalogItem | null> {
  const trimmed = description.trim();
  if (trimmed.length < 3) return null;

  const { tenant } = await getCurrentUserAndTenant();
  const candidates = await withTenant(tenant.id, (tx) => findSimilarCatalogItems(tx, trimmed, 5));
  if (candidates.length === 0) return null;

  return judgeCatalogMatch(trimmed, candidates);
}

/**
 * Short-lived preview URL for a document that isn't persisted to a
 * requisition yet — mid-wizard, or mid-attach-flow before the user has
 * confirmed. Once a document is persisted, callers should read
 * `sourceDocumentKey` server-side and call getRequisitionDocumentUrl
 * directly (as the requisitions list page already does) rather than
 * round-tripping through this action.
 */
export async function getRequisitionDocumentPreviewUrl(input: { key: string }): Promise<{ url?: string; error?: string }> {
  const { tenant } = await getCurrentUserAndTenant();
  if (!input.key.startsWith(`requisitions/${tenant.id}/`)) return { error: "Invalid document reference." };
  return { url: await getRequisitionDocumentUrl(input.key) };
}

/**
 * Replaces a draft requisition's line items and recomputes its total.
 * Draft-owner-only — a requisition that has left "draft" has no line-edit
 * path here (revision editing after rejection goes through
 * reviseAndResubmitRequisition instead, which also resubmits).
 */
export async function updateDraftLines(input: {
  requisitionId: string;
  lines: LineInput[];
}): Promise<{ error?: string }> {
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

  await withTenant(tenant.id, async (tx) => {
    const [existing] = await tx
      .select()
      .from(purchaseRequisitions)
      .where(
        and(
          eq(purchaseRequisitions.id, input.requisitionId),
          eq(purchaseRequisitions.requestorId, user.id),
          eq(purchaseRequisitions.status, "draft"),
        ),
      );
    if (!existing) return;

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
        priceConfirmed: l.priceConfirmed,
        lineTotal: l.lineTotal,
      })),
    );
    await tx.update(purchaseRequisitions).set({ totalEstimatedValue: total, updatedAt: new Date() }).where(eq(purchaseRequisitions.id, existing.id));

    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "requisition.lines_updated",
      entityType: "purchase_requisition",
      entityId: existing.id,
      metadata: { total, lineCount: linesWithTotals.length },
    });
  });

  revalidatePath(`/dashboard/requisitions/${input.requisitionId}`);
  return {};
}

/**
 * Attaches a source document and its extracted metadata to a draft that
 * was created without one — "the quotation will get added in time".
 * Draft-owner-only; never lets a document attach itself once the
 * requisition has moved past draft. Doesn't touch lines — pair with
 * updateDraftLines when the extraction also produced lines to apply.
 */
export async function attachRequisitionDocument(input: {
  requisitionId: string;
  sourceDocumentKey: string;
  documentMeta: ExtractedDocumentMeta;
}): Promise<{ error?: string }> {
  const { user, tenant } = await getCurrentUserAndTenant();

  await withTenant(tenant.id, async (tx) => {
    const [updated] = await tx
      .update(purchaseRequisitions)
      .set({ sourceDocumentKey: input.sourceDocumentKey, extractedDocumentMeta: input.documentMeta, updatedAt: new Date() })
      .where(
        and(
          eq(purchaseRequisitions.id, input.requisitionId),
          eq(purchaseRequisitions.requestorId, user.id),
          eq(purchaseRequisitions.status, "draft"),
        ),
      )
      .returning();
    if (!updated) return;

    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "requisition.document_attached",
      entityType: "purchase_requisition",
      entityId: updated.id,
      metadata: { key: input.sourceDocumentKey },
    });
  });

  revalidatePath(`/dashboard/requisitions/${input.requisitionId}`);
  return {};
}

/**
 * Who this requisition will go to if submitted as it currently stands.
 *
 * Called from the form as the department, cost centre or line values
 * change. Read-only — previewApprovalChain() reuses the real engine's
 * matching rather than reimplementing it, so what this says and what
 * submitting does cannot drift apart.
 */
export async function previewApprovers(input: {
  departmentId: string | null;
  costCenterId: string | null;
  totalEstimatedValue: string;
  categoryIds: string[];
}): Promise<ApprovalPreview> {
  const { user, tenant } = await getCurrentUserAndTenant();

  return withTenant(tenant.id, (tx) =>
    previewApprovalChain(
      tx,
      tenant.id,
      {
        currency: "INR",
        totalEstimatedValue: input.totalEstimatedValue,
        departmentId: input.departmentId,
        costCenterId: input.costCenterId,
        lineCategoryIds: [...new Set(input.categoryIds.filter(Boolean))],
      },
      user.id,
    ),
  );
}
