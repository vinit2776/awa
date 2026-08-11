import { and, eq } from "drizzle-orm";
import type { db } from "./client";
import { logAction } from "./audit";
import {
  purchaseOrders,
  purchaseOrderLines,
  purchaseRequisitions,
  goodsReceiptNotes,
  goodsReceiptLines,
  serviceAcceptances,
  serviceAcceptanceLines,
} from "./schema";

export type GoodsLineInput = {
  poLineId: string;
  quantityDelivered: string;
  quantityAccepted: string;
  quantityRejected: string;
  condition: "good" | "damaged" | "short";
  rejectionReason: string | null;
};

/**
 * "Full receipt only" (S8): one GRN event covers every open goods line
 * on the PO at once — no staged/partial delivery across multiple GRNs
 * per line. Per-line accept/reject quantities within that one event are
 * still supported (the schema carries them), that's a different axis
 * than partial delivery over time.
 *
 * receivedBy is checked against the requisition's requestor here too,
 * not just left to the DB trigger (app.enforce_receiver_not_requestor
 * on goods_receipt_lines) — the trigger is the real enforcement, this
 * is just a friendlier error than a raw constraint violation.
 */
export async function recordGoodsReceipt(
  tx: typeof db,
  tenantId: string,
  actorUserId: string,
  poId: string,
  receivedBy: string,
  deliveryNoteRef: string | null,
  lines: GoodsLineInput[],
): Promise<{ error?: string }> {
  const [po] = await tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.tenantId, tenantId)));
  if (!po || po.status === "cancelled") return { error: "This PO isn't open for receipt." };

  const [requisition] = await tx.select().from(purchaseRequisitions).where(eq(purchaseRequisitions.id, po.requisitionId));
  if (requisition && requisition.requestorId === receivedBy) {
    return { error: "The requisition's requestor can't verify their own goods receipt." };
  }

  if (lines.length === 0) return { error: "Nothing to receive." };

  const [grn] = await tx
    .insert(goodsReceiptNotes)
    .values({ tenantId, poId, deliveryNoteRef, receivedBy, status: "completed" })
    .returning();

  await tx.insert(goodsReceiptLines).values(
    lines.map((l) => ({
      tenantId,
      grnId: grn.id,
      poLineId: l.poLineId,
      quantityDelivered: l.quantityDelivered,
      quantityAccepted: l.quantityAccepted,
      quantityRejected: l.quantityRejected,
      condition: l.condition,
      rejectionReason: l.rejectionReason,
      verifiedBy: receivedBy,
    })),
  );

  for (const l of lines) {
    await tx.update(purchaseOrderLines).set({ status: "fulfilled" }).where(eq(purchaseOrderLines.id, l.poLineId));
  }

  await logAction(tx, {
    tenantId,
    actorUserId,
    action: "goods_receipt.recorded",
    entityType: "goods_receipt_note",
    entityId: grn.id,
    metadata: { poId, lineCount: lines.length },
  });

  await checkPoFulfilled(tx, tenantId, poId);
  return {};
}

export type ServiceLineInput = {
  poLineId: string;
  acceptedValue: string;
  status: "accepted" | "rejected" | "partial";
  rejectionReason: string | null;
};

/**
 * "Full completion only" (S8) — acceptance_type is always
 * full_completion; milestone-based partial billing (service_milestones
 * exists in the schema) is explicitly deferred per the roadmap.
 */
export async function recordServiceAcceptance(
  tx: typeof db,
  tenantId: string,
  actorUserId: string,
  poId: string,
  lines: ServiceLineInput[],
): Promise<{ error?: string }> {
  const [po] = await tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.tenantId, tenantId)));
  if (!po || po.status === "cancelled") return { error: "This PO isn't open for acceptance." };
  if (lines.length === 0) return { error: "Nothing to accept." };

  const [acceptance] = await tx
    .insert(serviceAcceptances)
    .values({ tenantId, poId, acceptanceType: "full_completion", status: "completed" })
    .returning();

  await tx.insert(serviceAcceptanceLines).values(
    lines.map((l) => ({
      tenantId,
      serviceAcceptanceId: acceptance.id,
      poLineId: l.poLineId,
      acceptedValue: l.acceptedValue,
      status: l.status,
      rejectionReason: l.rejectionReason,
      acceptedBy: actorUserId,
    })),
  );

  for (const l of lines) {
    await tx.update(purchaseOrderLines).set({ status: "fulfilled" }).where(eq(purchaseOrderLines.id, l.poLineId));
  }

  await logAction(tx, {
    tenantId,
    actorUserId,
    action: "service_acceptance.recorded",
    entityType: "service_acceptance",
    entityId: acceptance.id,
    metadata: { poId, lineCount: lines.length },
  });

  await checkPoFulfilled(tx, tenantId, poId);
  return {};
}

async function checkPoFulfilled(tx: typeof db, tenantId: string, poId: string) {
  const lines = await tx.select({ status: purchaseOrderLines.status }).from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, poId));
  const allFulfilled = lines.length > 0 && lines.every((l) => l.status === "fulfilled");
  if (allFulfilled) {
    await tx.update(purchaseOrders).set({ status: "fulfilled" }).where(eq(purchaseOrders.id, poId));
    await logAction(tx, {
      tenantId,
      action: "purchase_order.fulfilled",
      entityType: "purchase_order",
      entityId: poId,
      metadata: {},
    });
  }
}
