import { eq, ilike, inArray, or } from "drizzle-orm";
import type { db } from "./client";
import { findRequisitionIdsMatching } from "./requisitionSearch";
import {
  catalogItems,
  invoices,
  paymentInstructions,
  purchaseOrders,
  purchaseOrderLines,
  vendors,
} from "./schema";

/**
 * Search for the pages downstream of a requisition.
 *
 * Sourcing is keyed on a requisition, Fulfillment on a purchase order,
 * Invoices on an invoice, Payments on a payment instruction — four
 * entities. But nobody remembers a payment instruction. They remember the
 * helmets. So the rule these all follow is:
 *
 *   a record is findable by anything true of the requisition it descends
 *   from, plus whatever identifiers it has of its own
 *
 * Searching "helmet" on the payment queue finds the payment for the
 * helmet order, even though the word appears nowhere on the payment row.
 * Written the other way — each page matching only its own columns —
 * Fulfillment would find a PO by its number and nothing else, which is no
 * use to the person who knows only what came off the lorry.
 *
 * Each function returns ids, so the caller intersects with its own status
 * and scope filters rather than these needing to know about them. Same
 * shape as findRequisitionIdsMatching(), which is the root of the chain.
 */

/** Escapes LIKE wildcards so a literal % or _ searches for itself. */
function like(query: string): string {
  return `%${query.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Purchase orders matching, by their own identifiers or by the requisition
 * they were raised against.
 *
 * The joins are LEFT throughout: a PO with no lines is still a PO, and an
 * inner join would make it invisible to search — the quiet omission that
 * stops people trusting a search box.
 */
export async function findPurchaseOrderIdsMatching(tx: typeof db, query: string): Promise<string[]> {
  const trimmed = query.trim();
  if (trimmed === "") return [];
  const pattern = like(trimmed);

  const requisitionIds = await findRequisitionIdsMatching(tx, trimmed);

  const rows = await tx
    .selectDistinct({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .leftJoin(purchaseOrderLines, eq(purchaseOrderLines.poId, purchaseOrders.id))
    .leftJoin(catalogItems, eq(catalogItems.id, purchaseOrderLines.itemId))
    .leftJoin(vendors, eq(vendors.id, purchaseOrders.vendorId))
    .where(
      or(
        ilike(purchaseOrders.poNumber, pattern),
        ilike(vendors.name, pattern),
        // What the PO is for, in its own right — a PO line can carry a
        // service description the requisition never had.
        ilike(purchaseOrderLines.serviceDescription, pattern),
        ilike(catalogItems.name, pattern),
        // …and everything true of the requisition behind it.
        ...(requisitionIds.length > 0 ? [inArray(purchaseOrders.requisitionId, requisitionIds)] : []),
      ),
    );

  return rows.map((r) => r.id);
}

/** Invoices matching, by their own identifiers or by the purchase order and requisition behind them. */
export async function findInvoiceIdsMatching(tx: typeof db, query: string): Promise<string[]> {
  const trimmed = query.trim();
  if (trimmed === "") return [];
  const pattern = like(trimmed);

  const poIds = await findPurchaseOrderIdsMatching(tx, trimmed);

  const rows = await tx
    .selectDistinct({ id: invoices.id })
    .from(invoices)
    .leftJoin(vendors, eq(vendors.id, invoices.vendorId))
    .where(
      or(
        ilike(invoices.invoiceNumber, pattern),
        ilike(vendors.name, pattern),
        ...(poIds.length > 0 ? [inArray(invoices.poId, poIds)] : []),
      ),
    );

  return rows.map((r) => r.id);
}

/**
 * Payment instructions matching.
 *
 * The bank reference and the failure reason are the two things somebody
 * chasing a payment actually has in front of them, so both match here
 * rather than only the inherited set.
 */
export async function findPaymentIdsMatching(tx: typeof db, query: string): Promise<string[]> {
  const trimmed = query.trim();
  if (trimmed === "") return [];
  const pattern = like(trimmed);

  const invoiceIds = await findInvoiceIdsMatching(tx, trimmed);

  const rows = await tx
    .selectDistinct({ id: paymentInstructions.id })
    .from(paymentInstructions)
    .where(
      or(
        ilike(paymentInstructions.referenceNumber, pattern),
        ilike(paymentInstructions.failureReason, pattern),
        ...(invoiceIds.length > 0 ? [inArray(paymentInstructions.invoiceId, invoiceIds)] : []),
      ),
    );

  return rows.map((r) => r.id);
}

/** What each search box says it looks at, so the UI and this file can't drift apart. */
export const SOURCING_SEARCH_FIELDS = "item, requester, department, cost centre, and the justification notes";
export const FULFILLMENT_SEARCH_FIELDS = "PO number, vendor, item, and everything on the requisition behind it";
export const INVOICE_SEARCH_FIELDS = "invoice number, vendor, and everything on the order behind it";
export const PAYMENT_SEARCH_FIELDS = "bank reference, invoice number, vendor, and what was bought";
