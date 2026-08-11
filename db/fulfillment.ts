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
  serviceMilestones,
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
 * Partial/staged delivery (S17): a PO line can be received across
 * multiple GRN events over time — a short shipment now, the balance
 * later — so this sums quantity_accepted across every goods_receipt_line
 * recorded for a po_line so far (this event's rows plus any earlier
 * ones), not just the rows from this call. A line only reaches
 * 'fulfilled' once that running total meets the ordered quantity;
 * otherwise it goes to 'partially_fulfilled' and stays visible for a
 * follow-up receipt. This is also why db/invoiceMatch.ts has to sum
 * across the same rows instead of reading a single one — see the
 * comment there.
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
    const [poLine] = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.id, l.poLineId));
    if (!poLine) continue;

    const priorReceipts = await tx
      .select({ quantityAccepted: goodsReceiptLines.quantityAccepted })
      .from(goodsReceiptLines)
      .where(eq(goodsReceiptLines.poLineId, l.poLineId));
    const totalAccepted = priorReceipts.reduce((sum, r) => sum + Number(r.quantityAccepted), 0);
    const status = totalAccepted >= Number(poLine.quantity) ? "fulfilled" : "partially_fulfilled";
    await tx.update(purchaseOrderLines).set({ status }).where(eq(purchaseOrderLines.id, l.poLineId));
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
  // Set only for milestone-based acceptance (S18) — omitted/undefined
  // means the original full_completion path, unchanged.
  milestoneId?: string | null;
};

/**
 * Two acceptance modes, decided per line by whether milestoneId is set —
 * a PO either bills on full_completion or against service_milestones
 * rows, not a mix within one line, but a batch submitted from the
 * fulfillment page can still cover lines of both kinds if a PO somehow
 * had more than one service line in different modes.
 *
 * A rejected or partial line no longer gets marked 'fulfilled' (S17) —
 * that was a real bug: it meant rework never had anywhere to go, and
 * an unpaid, incomplete service line looked done. 'rejected' leaves the
 * PO line status untouched so it keeps showing as open for resubmission
 * once the vendor reworks it; 'partial' moves it to
 * 'partially_fulfilled', consistent with the goods side.
 *
 * Milestone-based (S18): service_milestones is scoped to the PO, not a
 * specific line — for the common case of one service line per PO this
 * is unambiguous. A line only reaches 'fulfilled' once every milestone
 * defined for the PO has an 'accepted' service_acceptance_lines row
 * recorded against *that line* — checked by summing across every past
 * acceptance event for the line, the same "sum across events" shape
 * S17 established for goods receipts, for the same reason: a milestone
 * PO is accepted across more than one submission over time.
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

  const acceptanceType = lines.some((l) => l.milestoneId) ? "milestone" : "full_completion";
  const [acceptance] = await tx
    .insert(serviceAcceptances)
    .values({ tenantId, poId, acceptanceType, status: "completed" })
    .returning();

  await tx.insert(serviceAcceptanceLines).values(
    lines.map((l) => ({
      tenantId,
      serviceAcceptanceId: acceptance.id,
      poLineId: l.poLineId,
      milestoneId: l.milestoneId ?? null,
      acceptedValue: l.acceptedValue,
      status: l.status,
      rejectionReason: l.rejectionReason,
      acceptedBy: actorUserId,
    })),
  );

  for (const l of lines) {
    if (l.milestoneId) {
      if (l.status === "accepted") {
        const poMilestones = await tx.select().from(serviceMilestones).where(eq(serviceMilestones.poId, poId));
        const priorAccepted = await tx
          .select({ milestoneId: serviceAcceptanceLines.milestoneId })
          .from(serviceAcceptanceLines)
          .innerJoin(serviceAcceptances, eq(serviceAcceptanceLines.serviceAcceptanceId, serviceAcceptances.id))
          .where(
            and(
              eq(serviceAcceptances.poId, poId),
              eq(serviceAcceptanceLines.poLineId, l.poLineId),
              eq(serviceAcceptanceLines.status, "accepted"),
            ),
          );
        const acceptedMilestoneIds = new Set(priorAccepted.map((p) => p.milestoneId).filter((id): id is string => id !== null));
        const status = poMilestones.length > 0 && acceptedMilestoneIds.size >= poMilestones.length ? "fulfilled" : "partially_fulfilled";
        await tx.update(purchaseOrderLines).set({ status }).where(eq(purchaseOrderLines.id, l.poLineId));
      } else if (l.status === "partial") {
        await tx.update(purchaseOrderLines).set({ status: "partially_fulfilled" }).where(eq(purchaseOrderLines.id, l.poLineId));
      }
      // rejected: leave untouched — that specific milestone can be resubmitted.
    } else if (l.status === "accepted") {
      await tx.update(purchaseOrderLines).set({ status: "fulfilled" }).where(eq(purchaseOrderLines.id, l.poLineId));
    } else if (l.status === "partial") {
      await tx.update(purchaseOrderLines).set({ status: "partially_fulfilled" }).where(eq(purchaseOrderLines.id, l.poLineId));
    }
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
