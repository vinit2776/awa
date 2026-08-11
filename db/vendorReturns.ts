import { and, eq } from "drizzle-orm";
import type { db } from "./client";
import { logAction } from "./audit";
import { goodsReceiptLines, vendorReturns } from "./schema";

/**
 * A linear lifecycle, not a free-form status field — a return can't
 * jump from 'initiated' straight to 'closed' skipping the shipment and
 * credit-note steps, since those are exactly the two pieces of paper
 * that make the return real (see §03: "Quality rejection → vendor_return
 * record — return shipment, credit note, status through to closed").
 */
export const VENDOR_RETURN_STATUSES = ["initiated", "shipped", "credited", "closed"] as const;
export type VendorReturnStatus = (typeof VENDOR_RETURN_STATUSES)[number];

export async function initiateVendorReturn(
  tx: typeof db,
  tenantId: string,
  actorUserId: string,
  grnLineId: string,
  quantity: string,
  reason: string,
): Promise<{ error?: string; returnId?: string }> {
  const [grnLine] = await tx
    .select()
    .from(goodsReceiptLines)
    .where(and(eq(goodsReceiptLines.id, grnLineId), eq(goodsReceiptLines.tenantId, tenantId)));
  if (!grnLine) return { error: "Receipt line not found." };
  if (!reason.trim()) return { error: "A reason is required." };
  if (Number(quantity) <= 0) return { error: "Return quantity must be greater than zero." };

  // A GRN line can be rejected once but returned in more than one
  // shipment (e.g. a partial credit now, the rest later) — so this
  // checks against what's already been claimed by earlier returns on
  // this same line, not just the line's total rejected quantity.
  const existingReturns = await tx.select().from(vendorReturns).where(eq(vendorReturns.grnLineId, grnLineId));
  const alreadyReturned = existingReturns.reduce((sum, r) => sum + Number(r.quantity), 0);
  if (alreadyReturned + Number(quantity) > Number(grnLine.quantityRejected) + 1e-9) {
    const remaining = (Number(grnLine.quantityRejected) - alreadyReturned).toFixed(3);
    return { error: `That's more than the remaining rejected quantity on this line (${remaining} left to return).` };
  }

  const [created] = await tx.insert(vendorReturns).values({ tenantId, grnLineId, quantity, reason: reason.trim() }).returning();
  await logAction(tx, {
    tenantId,
    actorUserId,
    action: "vendor_return.initiated",
    entityType: "vendor_return",
    entityId: created.id,
    metadata: { grnLineId, quantity, reason },
  });

  return { returnId: created.id };
}

export async function advanceVendorReturn(
  tx: typeof db,
  tenantId: string,
  actorUserId: string,
  returnId: string,
  nextStatus: VendorReturnStatus,
  reference: string | null,
): Promise<{ error?: string }> {
  const [ret] = await tx.select().from(vendorReturns).where(and(eq(vendorReturns.id, returnId), eq(vendorReturns.tenantId, tenantId)));
  if (!ret) return { error: "Return not found." };

  const currentIndex = VENDOR_RETURN_STATUSES.indexOf(ret.status as VendorReturnStatus);
  const nextIndex = VENDOR_RETURN_STATUSES.indexOf(nextStatus);
  if (nextIndex !== currentIndex + 1) {
    return { error: `A return can only advance one step at a time — can't move from "${ret.status}" to "${nextStatus}".` };
  }
  if (nextStatus === "shipped" && !reference?.trim()) return { error: "A return shipment reference is required." };
  if (nextStatus === "credited" && !reference?.trim()) return { error: "A credit note reference is required." };

  const patch: { status: VendorReturnStatus; returnShipmentRef?: string; creditNoteRef?: string } = { status: nextStatus };
  if (nextStatus === "shipped") patch.returnShipmentRef = reference!.trim();
  if (nextStatus === "credited") patch.creditNoteRef = reference!.trim();

  await tx.update(vendorReturns).set(patch).where(eq(vendorReturns.id, returnId));
  await logAction(tx, {
    tenantId,
    actorUserId,
    action: "vendor_return.advanced",
    entityType: "vendor_return",
    entityId: returnId,
    metadata: { status: nextStatus, reference },
  });

  return {};
}
