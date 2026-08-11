import { desc, eq } from "drizzle-orm";
import type { db } from "./client";
import { purchaseOrderLines, purchaseOrders, vendors } from "./schema";

export type ItemPurchaseHistoryEntry = {
  vendorName: string;
  unitPrice: string;
  quantity: string;
  poNumber: string;
  date: Date;
};

/**
 * Decision-support context for the approver inbox (S13, §04): "was this
 * item bought before, from whom, and at what price" — helps an approver
 * spot an estimate that's out of line with what the company has
 * actually paid in the past, before they approve it, not after.
 */
export async function getItemPurchaseHistory(
  tx: typeof db,
  catalogItemId: string,
  limit = 5,
): Promise<ItemPurchaseHistoryEntry[]> {
  const rows = await tx
    .select({
      vendorName: vendors.name,
      unitPrice: purchaseOrderLines.unitPrice,
      quantity: purchaseOrderLines.quantity,
      poNumber: purchaseOrders.poNumber,
      date: purchaseOrders.createdAt,
    })
    .from(purchaseOrderLines)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.poId))
    .innerJoin(vendors, eq(vendors.id, purchaseOrders.vendorId))
    .where(eq(purchaseOrderLines.itemId, catalogItemId))
    .orderBy(desc(purchaseOrders.createdAt))
    .limit(limit);

  return rows;
}
