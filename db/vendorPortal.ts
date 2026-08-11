import { and, desc, eq, isNull, ne } from "drizzle-orm";
import type { db } from "./client";
import { logAction } from "./audit";
import { catalogItems, purchaseOrderLines, purchaseOrders, signatories, users } from "./schema";

/**
 * A draft PO hasn't been issued yet — nothing for the vendor to see or
 * confirm. Everything from 'issued' onward (including 'cancelled') is
 * fair game: a vendor being told a PO was cancelled is exactly the kind
 * of thing the portal exists to surface directly, not leave to an email.
 */
export async function listVendorPos(tx: typeof db, vendorId: string) {
  return tx
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.vendorId, vendorId), ne(purchaseOrders.status, "draft")))
    .orderBy(desc(purchaseOrders.createdAt));
}

export async function getVendorPoDetail(tx: typeof db, vendorId: string, poId: string) {
  const [po] = await tx
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.vendorId, vendorId), ne(purchaseOrders.status, "draft")));
  if (!po) return null;

  const lines = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, poId));
  const items = await tx.select().from(catalogItems);

  let signatory: { name: string; title: string } | null = null;
  if (po.signedBy) {
    const [match] = await tx
      .select({ name: users.fullName, title: signatories.title })
      .from(signatories)
      .innerJoin(users, eq(users.id, signatories.userId))
      .where(and(eq(signatories.userId, po.signedBy), eq(signatories.active, true)));
    signatory = match ?? null;
  }

  return { po, lines, items, signatory };
}

/**
 * Idempotent by construction (the isNull guard) rather than by checking
 * first and branching — a vendor double-clicking Confirm, or two tabs
 * open, should never overwrite an earlier confirmation's timestamp/actor
 * with a later one.
 */
export async function confirmVendorPo(
  tx: typeof db,
  tenantId: string,
  poId: string,
  vendorUserId: string,
  vendorUserEmail: string,
) {
  const [updated] = await tx
    .update(purchaseOrders)
    .set({ vendorConfirmedAt: new Date(), vendorConfirmedBy: vendorUserId })
    .where(and(eq(purchaseOrders.id, poId), isNull(purchaseOrders.vendorConfirmedAt)))
    .returning();

  if (updated) {
    await logAction(tx, {
      tenantId,
      actorUserId: null,
      action: "po.vendor_confirmed",
      entityType: "purchase_order",
      entityId: poId,
      metadata: { vendorUserId, vendorUserEmail },
    });
  }
}
