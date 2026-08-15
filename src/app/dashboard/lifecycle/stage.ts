import type { purchaseOrders, invoices, paymentInstructions, purchaseRequisitions, rfqs } from "@/db/schema";

type Requisition = typeof purchaseRequisitions.$inferSelect;
type Rfq = typeof rfqs.$inferSelect;
type Po = typeof purchaseOrders.$inferSelect;
type Invoice = typeof invoices.$inferSelect;
type Payment = typeof paymentInstructions.$inferSelect;

/**
 * Later stages (RFQ, PO, GRN/service, invoice, payment) live on
 * separate tables, not on purchase_requisitions.status — this walks
 * the chain to say where a requisition actually is right now, for the
 * coordinator-facing lifecycle tracker (S10).
 */
export function computeStage(
  requisition: Requisition,
  rfqsForReq: Rfq[],
  poForReq: Po | undefined,
  invoiceForPo: Invoice | undefined,
  paymentForInvoice: Payment | undefined,
): string {
  if (requisition.status === "draft") return "Draft";
  if (requisition.status === "submitted") return "Submitted";
  if (requisition.status === "pending_approval") return "Pending approval";
  if (requisition.status === "rejected_revisable") return "Rejected — needs revision";
  if (requisition.status === "rejected_closed") return "Rejected — closed";
  if (requisition.status === "cancelled") return "Cancelled";

  if (requisition.status === "approved") return sourcingStage(rfqsForReq.length > 0);

  // converted_to_po from here on — walk PO -> invoice -> payment.
  if (!poForReq) return "Converted to PO";
  return poStage(poForReq, invoiceForPo, paymentForInvoice);
}

/** Stage label for the approved-but-not-yet-converted-to-PO window. Standalone so the Sourcing list can show it per row without walking the whole chain. */
export function sourcingStage(hasOpenRfq: boolean): string {
  return hasOpenRfq ? "Sourcing" : "Approved — awaiting sourcing";
}

/**
 * Stage label from PO issuance onward. Standalone (not just inlined in
 * computeStage) so Fulfillment pages — which load a PO without walking
 * back through the requisition — can show the exact same label.
 */
export function poStage(po: Po, invoiceForPo?: Invoice, paymentForInvoice?: Payment): string {
  if (po.status === "issued") return "PO issued — awaiting fulfillment";
  if (po.status === "partially_fulfilled") return "Partially fulfilled";
  if (po.status === "cancelled") return "PO cancelled";

  // po.status === "fulfilled" from here on.
  if (!invoiceForPo) return "Fulfilled — awaiting invoice";
  return invoiceStage(invoiceForPo, paymentForInvoice);
}

/** Stage label from invoice submission onward. Standalone so Invoices pages can show it without loading the PO. */
export function invoiceStage(invoice: Invoice, paymentForInvoice?: Payment): string {
  if (invoice.status === "submitted") return "Invoice submitted";
  if (invoice.status === "matched") return "Invoice matched — awaiting payment approval";
  if (invoice.status === "exception") return "Invoice exception — needs review";
  if (invoice.status === "disputed") return "Invoice disputed";
  if (invoice.status === "paid") return "Paid";

  // invoice.status === "approved_for_payment" from here on.
  if (!paymentForInvoice) return "Approved for payment";
  if (paymentForInvoice.status === "released") return "Paid";
  if (paymentForInvoice.status === "failed") return "Payment failed";
  return "Payment queued";
}

const STAGE_VARIANTS: Record<string, "neutral" | "info" | "warning" | "success" | "destructive"> = {
  "Draft": "neutral",
  "Cancelled": "neutral",
  "Submitted": "info",
  "Pending approval": "info",
  "Approved — awaiting sourcing": "info",
  "Sourcing": "info",
  "Converted to PO": "info",
  "PO issued — awaiting fulfillment": "info",
  "Partially fulfilled": "info",
  "Fulfilled — awaiting invoice": "info",
  "Invoice submitted": "info",
  "Invoice matched — awaiting payment approval": "info",
  "Approved for payment": "info",
  "Payment queued": "info",
  "Payment failed": "destructive",
  "Rejected — needs revision": "warning",
  "Invoice exception — needs review": "warning",
  "Rejected — closed": "destructive",
  "PO cancelled": "destructive",
  "Invoice disputed": "destructive",
  "Paid": "success",
};

/** Badge color for a stage string returned by computeStage(). Falls back to neutral for anything unrecognized. */
export function stageBadgeVariant(stage: string): "neutral" | "info" | "warning" | "success" | "destructive" {
  return STAGE_VARIANTS[stage] ?? "neutral";
}

const NEXT_ACTIONS: Record<string, string> = {
  "Draft": "Submit for approval when ready.",
  "Submitted": "Awaiting the approval queue to pick this up.",
  "Pending approval": "Awaiting an approver's decision.",
  "Approved — awaiting sourcing": "Awaiting sourcing to invite vendors or issue a PO directly.",
  "Sourcing": "Awaiting vendor quotations — compare and select to issue a PO.",
  "Converted to PO": "PO issuance in progress.",
  "PO issued — awaiting fulfillment": "Awaiting goods receipt or service acceptance.",
  "Partially fulfilled": "Awaiting the remaining goods or services.",
  "Fulfilled — awaiting invoice": "Awaiting the vendor's invoice.",
  "Invoice submitted": "Awaiting three-way match against the PO and receipt.",
  "Invoice matched — awaiting payment approval": "Awaiting finance approval for payment.",
  "Approved for payment": "Awaiting the payment to be queued.",
  "Payment queued": "Awaiting confirmation the payment was sent.",
  "Payment failed": "Retry with a corrected reference or payment method.",
  "Rejected — needs revision": "Revise and resubmit.",
  "Invoice exception — needs review": "Needs review — approve anyway or dispute.",
  "Rejected — closed": "Closed — no further action.",
  "PO cancelled": "No further action.",
  "Invoice disputed": "Disputed with the vendor — no resolution path yet.",
  "Paid": "Complete — nothing further to do.",
  "Cancelled": "No further action.",
};

/** What happens next for a stage string returned by computeStage(). Falls back to an em dash for anything unrecognized. */
export function nextAction(stage: string): string {
  return NEXT_ACTIONS[stage] ?? "—";
}
