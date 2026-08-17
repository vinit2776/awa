/**
 * What to call a clarification's subject.
 *
 * The href half of this file is gone: three of its five routes were
 * wrong, and they were wrong in a way no string could fix — a goods
 * receipt and a quotation have no page of their own, so reaching one
 * means joining to the PO or requisition it belongs to. That resolution
 * needs a database, so it lives in db/clarificationLinks.ts and arrives
 * on the row as `href`.
 */
export const ENTITY_LABEL: Record<string, string> = {
  requisition: "Requisition",
  purchase_order: "Purchase order",
  invoice: "Invoice",
  goods_receipt: "Goods receipt",
  quotation: "Quotation",
};

export function entityLabel(entityType: string): string {
  return ENTITY_LABEL[entityType] ?? entityType;
}
