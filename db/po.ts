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
 * Lines are copied from the requisition's lines, not the quotation —
 * vendor_quotations only carries a single total_amount (no per-line
 * pricing in this schema) — but their prices are rescaled so the lines
 * actually sum to what was agreed. Leaving PO line prices at the
 * requisition's estimates while the PO header carries the real quoted
 * total made every line "wrong" by construction whenever a quote didn't
 * match the estimate exactly (the normal case), and invoice 3-way
 * matching (db/invoiceMatch.ts) compares invoice lines against
 * poLine.unitPrice — so a correctly-priced invoice would always come
 * back a false "exception". Proportional allocation (by each line's
 * share of the estimated total) is the best available answer given the
 * schema has no per-line vendor pricing: it's exact for the common
 * single-line RFQ and a reasonable split for multi-line ones. Each
 * line's own unitPrice/lineTotal are always kept internally consistent
 * (see below) — the tradeoff is that the sum of lines can be off from
 * targetTotal by a cent or two on some multi-line quantities, which is
 * far less harmful than a blocking false exception on every invoice.
 */
function prorateLinesToTotal<T extends { quantity: string; estimatedUnitPrice: string; lineTotal: string }>(
  lines: T[],
  targetTotal: string,
): Array<T & { issuedUnitPrice: string; issuedLineTotal: string }> {
  const target = Number(targetTotal);
  const estimatedTotal = lines.reduce((sum, l) => sum + Number(l.lineTotal), 0);

  // unitPrice is rounded first and lineTotal is always derived from that
  // rounded value (quantity * issuedUnitPrice), never rounded
  // independently — invoice 3-way matching recomputes quantity *
  // poLine.unitPrice to compare against the invoice line, so a PO line
  // whose own lineTotal doesn't equal quantity * unitPrice reads as a
  // false variance against itself, before an invoice is even involved.
  // allocatedSoFar tracks the actually-stored (rounded) line totals, not
  // the raw shares, so the last line's remainder is computed against
  // what was really allocated — minimizing (not eliminating; 2-decimal
  // prices can't always divide a target evenly across quantities) drift
  // between the sum of lines and targetTotal.
  let allocatedSoFar = 0;
  return lines.map((line, i) => {
    const isLast = i === lines.length - 1;
    const quantity = Number(line.quantity);
    const lineTarget = isLast
      ? target - allocatedSoFar
      : target * (estimatedTotal > 0 ? Number(line.lineTotal) / estimatedTotal : 1 / lines.length);

    const issuedUnitPrice = (quantity > 0 ? lineTarget / quantity : 0).toFixed(2);
    const issuedLineTotal = (Number(issuedUnitPrice) * quantity).toFixed(2);
    allocatedSoFar += Number(issuedLineTotal);

    return { ...line, issuedUnitPrice, issuedLineTotal };
  });
}

/**
 * Issues a PO from an approved requisition and a quotation already
 * entered for it.
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

  const requisitionLines = await tx
    .select()
    .from(purchaseRequisitionLines)
    .where(eq(purchaseRequisitionLines.requisitionId, requisitionId));
  if (requisitionLines.length === 0) return { error: "This requisition has no lines to issue a PO for." };

  const lines = prorateLinesToTotal(requisitionLines, quotation.totalAmount);

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
      .map((l) => ({ itemId: l.catalogItemId, service: l.freeTextDescription, qty: l.quantity, unitPrice: l.issuedUnitPrice }))
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
      unitPrice: l.issuedUnitPrice,
      lineTotal: l.issuedLineTotal,
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

/**
 * Issues a PO straight from an approved requisition — no RFQ, no
 * quotation — for a simple purchase where the vendor and price are
 * already settled. Skips prorateLinesToTotal entirely: with no separate
 * quotation total to distribute across lines, each line's own confirmed
 * price (from `linePrices`, defaulting to the requisition's own estimate
 * for any line not explicitly priced) *is* the issued price, not a share
 * of something else.
 */
export async function issuePurchaseOrderDirect(
  tx: typeof db,
  tenantId: string,
  actorUserId: string,
  requisitionId: string,
  vendorId: string,
  linePrices: { lineId: string; unitPrice: string }[],
): Promise<{ error?: string; poId?: string }> {
  const [requisition] = await tx
    .select()
    .from(purchaseRequisitions)
    .where(and(eq(purchaseRequisitions.id, requisitionId), eq(purchaseRequisitions.status, "approved")));
  if (!requisition) return { error: "This requisition isn't approved and ready for sourcing." };

  const [vendor] = await tx.select().from(vendors).where(and(eq(vendors.id, vendorId), eq(vendors.status, "active")));
  if (!vendor) return { error: "That vendor isn't available to order from." };

  const requisitionLines = await tx
    .select()
    .from(purchaseRequisitionLines)
    .where(eq(purchaseRequisitionLines.requisitionId, requisitionId));
  if (requisitionLines.length === 0) return { error: "This requisition has no lines to issue a PO for." };

  const priceByLineId = new Map(linePrices.map((l) => [l.lineId, l.unitPrice]));
  const lines = requisitionLines.map((l) => {
    const issuedUnitPrice = Number(priceByLineId.get(l.id) ?? l.estimatedUnitPrice).toFixed(2);
    const issuedLineTotal = (Number(issuedUnitPrice) * Number(l.quantity)).toFixed(2);
    return { ...l, issuedUnitPrice, issuedLineTotal };
  });
  const totalAmount = lines.reduce((sum, l) => sum + Number(l.issuedLineTotal), 0).toFixed(2);

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
    totalAmount,
    currency: requisition.currency,
    lines: lines
      .map((l) => ({ itemId: l.catalogItemId, service: l.freeTextDescription, qty: l.quantity, unitPrice: l.issuedUnitPrice }))
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
      totalAmount,
      currency: requisition.currency,
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
      unitPrice: l.issuedUnitPrice,
      lineTotal: l.issuedLineTotal,
      status: "issued" as const,
    })),
  );

  await tx.update(purchaseRequisitions).set({ status: "converted_to_po" }).where(eq(purchaseRequisitions.id, requisitionId));

  await logAction(tx, {
    tenantId,
    actorUserId,
    action: "purchase_order.issued_direct",
    entityType: "purchase_order",
    entityId: po.id,
    metadata: { poNumber, vendorId, totalAmount },
  });

  const [contact] = await tx.select().from(vendorUsers).where(eq(vendorUsers.vendorId, vendorId)).limit(1);
  await notifyVendor(contact?.email ?? null, `Purchase order ${poNumber} from ${vendor.name}`, `PO ${poNumber} has been issued. Total: ${totalAmount} ${requisition.currency}.`);

  return { poId: po.id };
}
