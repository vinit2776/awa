import { createHash, randomBytes } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import type { db } from "./client";
import { logAction } from "./audit";
import { notifyVendor } from "./notifications";
import {
  purchaseRequisitions,
  purchaseRequisitionLines,
  purchaseOrders,
  purchaseOrderLines,
  vendorQuotations,
  vendors,
  vendorUsers,
} from "./schema";

/**
 * Issues a PO from an approved requisition and a quotation already
 * entered for it. Lines are copied from the requisition's lines, not
 * the quotation — vendor_quotations only carries a single total_amount
 * (no per-line pricing in this schema), so PO line unit prices are the
 * requisition's estimated prices while purchase_orders.total_amount is
 * the vendor's actual quoted total. The two can differ; that's expected,
 * not a bug — the total is what was actually agreed, the lines are what
 * was actually ordered.
 *
 * document_hash is computed once, here, from canonical PO content and
 * stored — never recomputed on each PDF download, so it can't drift.
 * qr_token is a random opaque id; nothing resolves it yet (the
 * vendor-facing verification page is phase 2 per the roadmap), it's
 * just reserved and embedded in the PDF now so today's issued POs stay
 * valid once that page exists.
 */
export async function issuePurchaseOrder(
  tx: typeof db,
  tenantId: string,
  actorUserId: string,
  requisitionId: string,
  vendorId: string,
  quotationId: string,
): Promise<{ error?: string; poId?: string }> {
  const [requisition] = await tx
    .select()
    .from(purchaseRequisitions)
    .where(and(eq(purchaseRequisitions.id, requisitionId), eq(purchaseRequisitions.status, "approved")));
  if (!requisition) return { error: "This requisition isn't approved and ready for sourcing." };

  const [quotation] = await tx
    .select()
    .from(vendorQuotations)
    .where(and(eq(vendorQuotations.id, quotationId), eq(vendorQuotations.vendorId, vendorId), eq(vendorQuotations.status, "submitted")));
  if (!quotation) return { error: "That quotation isn't available to select." };

  const lines = await tx
    .select()
    .from(purchaseRequisitionLines)
    .where(eq(purchaseRequisitionLines.requisitionId, requisitionId));
  if (lines.length === 0) return { error: "This requisition has no lines to issue a PO for." };

  const [{ value: existingCount }] = await tx
    .select({ value: count() })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.tenantId, tenantId));
  const poNumber = `PO-${new Date().getFullYear()}-${String(existingCount + 1).padStart(4, "0")}`;
  const qrToken = randomBytes(16).toString("hex");

  const canonicalContent = JSON.stringify({
    poNumber,
    requisitionId,
    vendorId,
    totalAmount: quotation.totalAmount,
    currency: quotation.currency,
    lines: lines
      .map((l) => ({ itemId: l.catalogItemId, service: l.freeTextDescription, qty: l.quantity, unitPrice: l.estimatedUnitPrice }))
      .sort((a, b) => (a.itemId ?? a.service ?? "").localeCompare(b.itemId ?? b.service ?? "")),
  });
  const documentHash = createHash("sha256").update(canonicalContent).digest("hex");

  const [po] = await tx
    .insert(purchaseOrders)
    .values({
      tenantId,
      requisitionId,
      vendorId,
      poNumber,
      status: "issued",
      totalAmount: quotation.totalAmount,
      currency: quotation.currency,
      documentHash,
      qrToken,
      signedBy: actorUserId,
      signedAt: new Date(),
    })
    .returning();

  await tx.insert(purchaseOrderLines).values(
    lines.map((l) => ({
      tenantId,
      poId: po.id,
      requisitionLineId: l.id,
      fulfillmentType: l.fulfillmentType,
      itemId: l.catalogItemId,
      serviceDescription: l.freeTextDescription,
      quantity: l.quantity,
      uom: l.uom,
      unitPrice: l.estimatedUnitPrice,
      lineTotal: l.lineTotal,
      status: "issued" as const,
    })),
  );

  await tx.update(vendorQuotations).set({ status: "selected" }).where(eq(vendorQuotations.id, quotationId));
  await tx
    .update(vendorQuotations)
    .set({ status: "rejected" })
    .where(and(eq(vendorQuotations.rfqId, quotation.rfqId), eq(vendorQuotations.status, "submitted")));

  await tx.update(purchaseRequisitions).set({ status: "converted_to_po" }).where(eq(purchaseRequisitions.id, requisitionId));

  await logAction(tx, {
    tenantId,
    actorUserId,
    action: "purchase_order.issued",
    entityType: "purchase_order",
    entityId: po.id,
    metadata: { poNumber, vendorId, totalAmount: quotation.totalAmount },
  });

  const [vendor] = await tx.select().from(vendors).where(eq(vendors.id, vendorId));
  const [contact] = await tx.select().from(vendorUsers).where(eq(vendorUsers.vendorId, vendorId)).limit(1);
  await notifyVendor(contact?.email ?? null, `Purchase order ${poNumber} from ${vendor?.name ?? "us"}`, `PO ${poNumber} has been issued. Total: ${quotation.totalAmount} ${quotation.currency}.`);

  return { poId: po.id };
}
