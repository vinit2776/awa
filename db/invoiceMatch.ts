import { eq } from "drizzle-orm";
import type { db } from "./client";
import { logAction } from "./audit";
import {
  invoices,
  invoiceLines,
  invoiceLineMatches,
  purchaseOrderLines,
  goodsReceiptLines,
  serviceAcceptanceLines,
} from "./schema";

const EPSILON = 0.005;

/**
 * Exact 3-way match (phase 1 — no fuzzy tolerance yet, per the roadmap):
 * for each invoice line, compares what was ordered (the PO line) against
 * what was actually received/accepted (goods_receipt_line rows or a
 * service_acceptance_line) and what's being billed (the invoice line).
 *
 * Goods lines now sum quantity_accepted across every goods_receipt_line
 * recorded for the PO line (S17: partial/staged delivery over multiple
 * GRN events, db/fulfillment.ts#recordGoodsReceipt) instead of assuming
 * exactly one row — that one-record assumption was real and is exactly
 * what broke a two-shipment delivery: the invoice would get compared
 * against only the first shipment's quantity, permanently exception'd
 * even after the balance arrived. matched_fulfillment_id still has to
 * be a single id (polymorphic, application-enforced, no FK) even though
 * the match itself is now a sum — it points at the most recently
 * verified receipt line, for traceability, not as the sole source of
 * matched_quantity/matched_value (those are the sums).
 *
 * Service lines have no quantity concept in service_acceptance_lines,
 * so only value is checked, and still read a single row — milestone-
 * based service acceptance (multiple acceptance events per line) is
 * explicitly deferred, so this hasn't hit the same bug yet.
 *
 * No fulfillment record at all (invoiced before receipt) is always an
 * exception. matched_fulfillment_id is NOT NULL with no FK (it's
 * polymorphic, enforced in application code per the schema comment) —
 * when there's genuinely nothing to point at yet, it falls back to the
 * PO line's own id rather than leaving the column unrepresentable;
 * status='exception' is what actually signals "no fulfillment found",
 * not this id.
 */
export async function matchInvoice(tx: typeof db, tenantId: string, invoiceId: string) {
  const lines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId));

  let anyException = false;

  for (const line of lines) {
    if (!line.poLineId) {
      anyException = true;
      continue;
    }

    const [poLine] = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.id, line.poLineId));
    if (!poLine) {
      anyException = true;
      continue;
    }

    if (poLine.fulfillmentType === "goods") {
      const grnLines = await tx.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.poLineId, poLine.id));
      const hasReceipt = grnLines.length > 0;
      const totalAccepted = grnLines.reduce((sum, g) => sum + Number(g.quantityAccepted), 0);
      const expectedValue = hasReceipt ? totalAccepted * Number(poLine.unitPrice) : null;
      const quantityMatches = hasReceipt && Number(line.quantity) === totalAccepted;
      const valueMatches = expectedValue !== null && Math.abs(Number(line.lineTotal) - expectedValue) < EPSILON;
      const status = quantityMatches && valueMatches ? "matched" : "exception";
      const variance = expectedValue !== null ? Number(line.lineTotal) - expectedValue : Number(line.lineTotal);
      const latestGrnLine = grnLines.reduce<typeof grnLines[number] | null>(
        (latest, g) => (!latest || g.verifiedAt > latest.verifiedAt ? g : latest),
        null,
      );

      if (status === "exception") anyException = true;

      await tx.insert(invoiceLineMatches).values({
        tenantId,
        invoiceLineId: line.id,
        poLineId: poLine.id,
        matchedFulfillmentType: "goods_receipt_line",
        matchedFulfillmentId: latestGrnLine?.id ?? poLine.id,
        matchedQuantity: hasReceipt ? totalAccepted.toFixed(3) : null,
        matchedValue: expectedValue?.toFixed(2) ?? null,
        variance: variance.toFixed(2),
        status,
      });
    } else {
      const [serviceLine] = await tx.select().from(serviceAcceptanceLines).where(eq(serviceAcceptanceLines.poLineId, poLine.id));
      const expectedValue = serviceLine ? Number(serviceLine.acceptedValue) : null;
      const valueMatches = expectedValue !== null && Math.abs(Number(line.lineTotal) - expectedValue) < EPSILON;
      const status = serviceLine && valueMatches ? "matched" : "exception";
      const variance = expectedValue !== null ? Number(line.lineTotal) - expectedValue : Number(line.lineTotal);

      if (status === "exception") anyException = true;

      await tx.insert(invoiceLineMatches).values({
        tenantId,
        invoiceLineId: line.id,
        poLineId: poLine.id,
        matchedFulfillmentType: "service_acceptance_line",
        matchedFulfillmentId: serviceLine?.id ?? poLine.id,
        matchedQuantity: null,
        matchedValue: expectedValue?.toFixed(2) ?? null,
        variance: variance.toFixed(2),
        status,
      });
    }
  }

  const finalStatus = anyException ? "exception" : "matched";
  await tx.update(invoices).set({ status: finalStatus }).where(eq(invoices.id, invoiceId));
  await logAction(tx, {
    tenantId,
    action: "invoice.matched",
    entityType: "invoice",
    entityId: invoiceId,
    metadata: { status: finalStatus, lineCount: lines.length },
  });

  return { status: finalStatus };
}
