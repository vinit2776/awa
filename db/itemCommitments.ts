import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { db } from "./client";
import {
  purchaseOrders,
  purchaseOrderLines,
  goodsReceiptLines,
  vendors,
  purchaseRequisitions,
  purchaseRequisitionLines,
  users,
} from "./schema";

export type OnOrderRef = {
  poNumber: string;
  vendorName: string;
  // Ordered quantity minus everything accepted against it so far —
  // see the module docblock for why this has to be a sum, not the
  // line's raw quantity.
  outstandingQuantity: number;
};

export type PipelineRef = {
  requisitionId: string;
  quantity: number;
  status: "submitted" | "pending_approval" | "approved";
  requestorName: string;
};

/**
 * One uom's worth of commitment data. Deliberately the unit this module
 * hands back — see getOpenCommitmentsForItem's docblock for why quantities
 * are never combined across a different uom.
 */
export type CommitmentsByUom = {
  uom: string;
  onOrder: OnOrderRef[];
  onOrderTotal: number;
  pipeline: PipelineRef[];
  pipelineTotal: number;
};

export type OpenCommitments = CommitmentsByUom[];

/**
 * "What's already committed for this catalogue item, before you order
 * more?" — the requisition-line-entry counterpart to the approver's
 * decision-support panel (db/itemHistory.ts): that one answers "what did
 * we pay before", this one answers "how much is already spoken for".
 * Informational only, per the S19 brief — nothing here blocks a line,
 * it's context for a person to weigh, same as the budget bar and the
 * approval-chain preview.
 *
 * Two independent figures, each summed by a genuinely different rule, so
 * they're computed separately rather than forced into one query:
 *
 * On order, not yet received — purchase_order_lines for this item whose
 * parent PO is 'issued' or 'partially_fulfilled' (never 'draft', which
 * hasn't committed anything yet, and never 'cancelled') and whose own
 * line status isn't 'cancelled' or 'fulfilled'. The outstanding amount is
 * the line's ordered quantity minus the sum of quantity_accepted across
 * every goods_receipt_line recorded against it — the exact definition
 * db/fulfillment.ts#recordGoodsReceipt uses to decide when a line becomes
 * 'fulfilled' (and that db/invoiceMatch.ts sums the same way, for the
 * same "a line can be received across several deliveries" reason). A
 * second, almost-right definition here — say, just reading the line's
 * quantity and ignoring receipts entirely — is exactly the kind of drift
 * this codebase goes out of its way to avoid; see the S17 comment in
 * fulfillment.ts. Lines whose outstanding balance is zero or negative
 * (fully received, or over-received) are dropped rather than shown as a
 * confusing zero.
 *
 * In the pipeline, not yet ordered — purchase_requisition_lines for this
 * item whose requisition is 'submitted', 'pending_approval' or
 * 'approved'. 'converted_to_po' is excluded on purpose, and this is the
 * subtle part: once a requisition converts to a PO, its quantity is
 * already being counted by the on-order figure above (as a
 * purchase_order_line). Counting it here too would double-count the same
 * physical commitment under two different names and silently inflate
 * every number this feature exists to report. 'draft' is excluded because
 * it isn't a commitment yet (nobody but the author has seen it); so are
 * 'cancelled' and 'rejected_closed'. 'rejected_revisable' is also
 * excluded — it's been sent back to the requester, who must revise and
 * resubmit before it becomes live again, so until that happens it isn't
 * a current commitment either.
 *
 * This status list is intentionally NOT the one db/budget.ts uses
 * (getCommittedByCostCenter excludes only draft/cancelled/rejected_closed,
 * and does include 'converted_to_po'). That function answers "what is
 * spoken for against this cost centre's budget" — a requisition that
 * became a PO is still spending that budget, so it stays in. This
 * function answers "what hasn't become a PO yet" — the moment it does,
 * it graduates out of 'pipeline' and into 'on order'. Same underlying
 * data, two different questions; unifying the lists would answer neither
 * one correctly.
 *
 * Return shape: grouped per uom (see CommitmentsByUom) rather than one
 * flat total, because uom is free text on both tables — "10 boxes" and
 * "100 each" can't be added, and a caller reaching for a single grand
 * total across mismatched units would get a confidently wrong number.
 * Grouping by uom here, once, means every caller gets it right by
 * construction instead of having to remember the rule themselves.
 */
export async function getOpenCommitmentsForItem(tx: typeof db, catalogItemId: string): Promise<OpenCommitments> {
  const onOrderRows = await tx
    .select({
      poNumber: purchaseOrders.poNumber,
      vendorName: vendors.name,
      quantity: purchaseOrderLines.quantity,
      uom: purchaseOrderLines.uom,
      receivedQuantity: sql<string>`coalesce(sum(${goodsReceiptLines.quantityAccepted}), 0)`,
    })
    .from(purchaseOrderLines)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.poId))
    .innerJoin(vendors, eq(vendors.id, purchaseOrders.vendorId))
    .leftJoin(goodsReceiptLines, eq(goodsReceiptLines.poLineId, purchaseOrderLines.id))
    .where(
      and(
        eq(purchaseOrderLines.itemId, catalogItemId),
        inArray(purchaseOrders.status, ["issued", "partially_fulfilled"]),
        notInArray(purchaseOrderLines.status, ["cancelled", "fulfilled"]),
      ),
    )
    .groupBy(purchaseOrderLines.id, purchaseOrders.id, vendors.id);

  const pipelineRows = await tx
    .select({
      requisitionId: purchaseRequisitionLines.requisitionId,
      quantity: purchaseRequisitionLines.quantity,
      uom: purchaseRequisitionLines.uom,
      status: purchaseRequisitions.status,
      requestorName: users.fullName,
    })
    .from(purchaseRequisitionLines)
    .innerJoin(purchaseRequisitions, eq(purchaseRequisitions.id, purchaseRequisitionLines.requisitionId))
    .innerJoin(users, eq(users.id, purchaseRequisitions.requestorId))
    .where(
      and(
        eq(purchaseRequisitionLines.catalogItemId, catalogItemId),
        inArray(purchaseRequisitions.status, ["submitted", "pending_approval", "approved"]),
      ),
    );

  const groups = new Map<string, CommitmentsByUom>();
  const groupFor = (uom: string): CommitmentsByUom => {
    let group = groups.get(uom);
    if (!group) {
      group = { uom, onOrder: [], onOrderTotal: 0, pipeline: [], pipelineTotal: 0 };
      groups.set(uom, group);
    }
    return group;
  };

  for (const row of onOrderRows) {
    const outstandingQuantity = Number(row.quantity) - Number(row.receivedQuantity);
    if (outstandingQuantity <= 0) continue;
    const group = groupFor(row.uom);
    group.onOrder.push({ poNumber: row.poNumber, vendorName: row.vendorName, outstandingQuantity });
    group.onOrderTotal += outstandingQuantity;
  }

  for (const row of pipelineRows) {
    const quantity = Number(row.quantity);
    const group = groupFor(row.uom);
    group.pipeline.push({
      requisitionId: row.requisitionId,
      quantity,
      status: row.status as "submitted" | "pending_approval" | "approved",
      requestorName: row.requestorName,
    });
    group.pipelineTotal += quantity;
  }

  return [...groups.values()];
}
