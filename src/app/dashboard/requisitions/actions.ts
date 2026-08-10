"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { logAction } from "@/db/audit";
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
  });

  revalidatePath("/dashboard/requisitions");
}
