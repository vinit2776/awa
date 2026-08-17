/**
 * Where a clarification's subject actually lives, and what to call it.
 *
 * Extracted from the Queries page so the Today page links the same way.
 * Two copies of a route map is how one of them quietly rots — which is
 * exactly what happened to the requisition entry: it pointed at
 * /dashboard/requisitions/[id] from the day Queries shipped, and that
 * route had no page until this branch added one, so following a query on
 * a requisition 404'd the whole time.
 */
export const ENTITY_LABEL: Record<string, string> = {
  requisition: "Requisition",
  purchase_order: "Purchase order",
  invoice: "Invoice",
  goods_receipt: "Goods receipt",
  quotation: "Quotation",
};

/**
 * NOTE — two of these look wrong and are left exactly as they were,
 * because changing where a link points is a product decision, not a
 * tidy-up:
 *
 *   purchase_order → /dashboard/sourcing/[id] takes a *requisition* id,
 *                    so handing it a PO id will notFound(). The
 *                    fulfillment route is the one keyed by PO id.
 *   goods_receipt  → /dashboard/fulfillment/[poId] takes a *PO* id, so a
 *                    goods-receipt id won't resolve either. Fixing this
 *                    needs a lookup from receipt to PO, not a new string.
 *
 * requisition and invoice are correct.
 */
export const ENTITY_HREF: Record<string, (id: string) => string> = {
  requisition: (id) => `/dashboard/requisitions/${id}`,
  purchase_order: (id) => `/dashboard/sourcing/${id}`,
  invoice: (id) => `/dashboard/invoices/${id}`,
  goods_receipt: (id) => `/dashboard/fulfillment/${id}`,
  quotation: (id) => `/dashboard/sourcing/${id}`,
};

export function entityHref(entityType: string, entityId: string): string | null {
  return ENTITY_HREF[entityType]?.(entityId) ?? null;
}

export function entityLabel(entityType: string): string {
  return ENTITY_LABEL[entityType] ?? entityType;
}
