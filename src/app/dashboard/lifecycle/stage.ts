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

  if (requisition.status === "approved") {
    return rfqsForReq.length > 0 ? "Sourcing" : "Approved — awaiting sourcing";
  }

  // converted_to_po from here on — walk PO -> invoice -> payment.
  if (!poForReq) return "Converted to PO";
  if (poForReq.status === "issued") return "PO issued — awaiting fulfillment";
  if (poForReq.status === "partially_fulfilled") return "Partially fulfilled";
  if (poForReq.status === "cancelled") return "PO cancelled";

  // poForReq.status === "fulfilled" from here on.
  if (!invoiceForPo) return "Fulfilled — awaiting invoice";
  if (invoiceForPo.status === "submitted") return "Invoice submitted";
  if (invoiceForPo.status === "matched") return "Invoice matched — awaiting payment approval";
  if (invoiceForPo.status === "exception") return "Invoice exception — needs review";
  if (invoiceForPo.status === "disputed") return "Invoice disputed";
  if (invoiceForPo.status === "paid") return "Paid";

  // invoiceForPo.status === "approved_for_payment" from here on.
  if (!paymentForInvoice) return "Approved for payment";
  return paymentForInvoice.status === "released" ? "Paid" : "Payment queued";
}
