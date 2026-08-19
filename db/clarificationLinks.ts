import { inArray } from "drizzle-orm";
import type { db } from "./client";
import type { ClarificationEntityType } from "./clarificationRules";
import { goodsReceiptNotes, rfqs, vendorQuotations } from "./schema";

/**
 * Where a clarification's subject can actually be opened.
 *
 * This used to be a static map of entityType -> `/route/${entityId}` in
 * the Queries page, and three of its five entries were wrong: they
 * handed an id to a route keyed by a *different* entity, so the link
 * 404'd. That is not fixable with a better string, because AWA has no
 * page per goods receipt or per quotation — the place you go to see one
 * is the PO or the requisition it belongs to, and getting from one to
 * the other is a join:
 *
 *   goods_receipt  -> goods_receipt_notes.poId    -> /dashboard/fulfillment/[poId]
 *   quotation      -> rfqs.requisitionId (via rfqId) -> /dashboard/sourcing/[id]
 *   purchase_order -> keyed by PO id already, but pointed at the sourcing
 *                     route, which takes a requisition id
 *
 * Resolved in bulk rather than per row: the Queries inbox and the Today
 * page both render a list, and a per-row lookup would be a query per
 * question on the page.
 */

export type ClarificationTarget = { entityType: ClarificationEntityType; entityId: string };

/** Routes that need no lookup — the id in the clarification is already the id in the URL. */
const DIRECT_ROUTES: Partial<Record<ClarificationEntityType, (id: string) => string>> = {
  requisition: (id) => `/dashboard/requisitions/${id}`,
  invoice: (id) => `/dashboard/invoices/${id}`,
  purchase_order: (id) => `/dashboard/fulfillment/${id}`,
};

/**
 * Hrefs for a batch of clarification subjects, keyed `${entityType}:${entityId}`.
 * An entry is absent when the record it points at no longer exists — callers
 * should fall back to /dashboard/queries rather than rendering a dead link.
 */
export async function resolveClarificationHrefs(
  tx: typeof db,
  targets: ClarificationTarget[],
): Promise<Map<string, string>> {
  const hrefs = new Map<string, string>();
  const key = (t: ClarificationTarget) => `${t.entityType}:${t.entityId}`;

  for (const target of targets) {
    const direct = DIRECT_ROUTES[target.entityType]?.(target.entityId);
    if (direct) hrefs.set(key(target), direct);
  }

  const grnIds = targets.filter((t) => t.entityType === "goods_receipt").map((t) => t.entityId);
  if (grnIds.length > 0) {
    const notes = await tx
      .select({ id: goodsReceiptNotes.id, poId: goodsReceiptNotes.poId })
      .from(goodsReceiptNotes)
      .where(inArray(goodsReceiptNotes.id, grnIds));
    for (const note of notes) {
      hrefs.set(`goods_receipt:${note.id}`, `/dashboard/fulfillment/${note.poId}`);
    }
  }

  const quotationIds = targets.filter((t) => t.entityType === "quotation").map((t) => t.entityId);
  if (quotationIds.length > 0) {
    // Two hops: a quotation belongs to an RFQ, and the sourcing screen is
    // keyed by the requisition the RFQ was raised for.
    const quotations = await tx
      .select({ id: vendorQuotations.id, rfqId: vendorQuotations.rfqId })
      .from(vendorQuotations)
      .where(inArray(vendorQuotations.id, quotationIds));

    const rfqIds = [...new Set(quotations.map((q) => q.rfqId))];
    const rfqRows = rfqIds.length
      ? await tx.select({ id: rfqs.id, requisitionId: rfqs.requisitionId }).from(rfqs).where(inArray(rfqs.id, rfqIds))
      : [];

    for (const quotation of quotations) {
      const requisitionId = rfqRows.find((r) => r.id === quotation.rfqId)?.requisitionId;
      if (requisitionId) hrefs.set(`quotation:${quotation.id}`, `/dashboard/sourcing/${requisitionId}`);
    }
  }

  return hrefs;
}

/** Single-target convenience for a caller that already holds a transaction. */
export async function resolveClarificationHref(
  tx: typeof db,
  entityType: ClarificationEntityType,
  entityId: string,
): Promise<string | null> {
  const hrefs = await resolveClarificationHrefs(tx, [{ entityType, entityId }]);
  return hrefs.get(`${entityType}:${entityId}`) ?? null;
}

/** Never resolves to a route — used when the subject record has been deleted. */
export const CLARIFICATION_FALLBACK_HREF = "/dashboard/queries";
