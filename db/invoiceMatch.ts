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
 * what was actually received/accepted (a goods_receipt_line or
 * service_acceptance_line) and what's being billed (the invoice line).
 *
 * Assumes one fulfillment record per PO line, which is what Sprint 8's
 * "full receipt only" flow actually produces (a PO line is only ever
 * received/accepted once, then excluded from further receipt forms) —
 * if that assumption ever stops holding (partial/staged receipt), this
 * needs to sum across multiple fulfillment rows instead of taking one.
 *
 * Goods lines check both quantity and value; service lines have no
 * quantity concept in service_acceptance_lines, so only value is
 * checked. No fulfillment record at all (invoiced before receipt) is
 * always an exception. matched_fulfillment_id is NOT NULL with no FK
 * (it's polymorphic, enforced in application code per the schema
 * comment) — when there's genuinely nothing to point at yet, it falls
 * back to the PO line's own id rather than leaving the column
 * unrepresentable; status='exception' is what actually signals "no
 * fulfillment found", not this id.
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
      const [grnLine] = await tx.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.poLineId, poLine.id));
      const expectedValue = grnLine ? Number(grnLine.quantityAccepted) * Number(poLine.unitPrice) : null;
      const quantityMatches = grnLine ? Number(line.quantity) === Number(grnLine.quantityAccepted) : false;
      const valueMatches = expectedValue !== null && Math.abs(Number(line.lineTotal) - expectedValue) < EPSILON;
      const status = grnLine && quantityMatches && valueMatches ? "matched" : "exception";
      const variance = expectedValue !== null ? Number(line.lineTotal) - expectedValue : Number(line.lineTotal);

      if (status === "exception") anyException = true;

      await tx.insert(invoiceLineMatches).values({
        tenantId,
        invoiceLineId: line.id,
        poLineId: poLine.id,
        matchedFulfillmentType: "goods_receipt_line",
        matchedFulfillmentId: grnLine?.id ?? poLine.id,
        matchedQuantity: grnLine?.quantityAccepted ?? null,
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
