import type { purchaseOrders, invoices, paymentInstructions, purchaseRequisitions, rfqs } from "@/db/schema";
import type { GlossaryKey } from "@/lib/glossary";

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
 * "Step X of Y" for a requisition sitting in Pending approval — the
 * detail nextStep() can't express, since which rule matched and how
 * many groups it has is data, not a fixed stage string. Needs every
 * requirement row for the requisition (every group, any status), not
 * just the pending ones, to know the true step count. Returns null for
 * a single-step chain (group 1 of 1) — not worth saying.
 */
export function approvalStepDetail(requirementRows: { groupNo: number; status: string }[]): string | null {
  if (requirementRows.length === 0) return null;
  const totalSteps = new Set(requirementRows.map((r) => r.groupNo)).size;
  if (totalSteps <= 1) return null;
  const pendingGroups = requirementRows.filter((r) => r.status === "pending").map((r) => r.groupNo);
  if (pendingGroups.length === 0) return null;
  const currentStep = Math.min(...pendingGroups);
  return `Step ${currentStep} of ${totalSteps}`;
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

/**
 * The seven stages every transaction passes through, in order — the
 * spine the whole product is explained against. Deliberately the formal
 * procurement names, matching what appears on the PO and what a
 * customer's auditor expects; src/lib/glossary.ts is where each one is
 * defined for somebody meeting it for the first time.
 */
export const LIFECYCLE_STEPS = [
  { key: "requisition", label: "Requisition", term: "requisition" },
  { key: "approval", label: "Approval", term: "approval-step" },
  { key: "sourcing", label: "Sourcing", term: "rfq" },
  { key: "purchase_order", label: "Purchase order", term: "purchase-order" },
  { key: "receipt", label: "Receipt", term: "goods-receipt" },
  { key: "invoice", label: "Invoice", term: "three-way-match" },
  { key: "payment", label: "Payment", term: "payment-instruction" },
] as const satisfies readonly { key: string; label: string; term: GlossaryKey }[];

export type LifecycleStepKey = (typeof LIFECYCLE_STEPS)[number]["key"];

export type StageBadgeVariant = "neutral" | "info" | "warning" | "success" | "destructive";

/**
 * How a record is doing at whichever step it is standing on:
 *
 *   moving     progressing normally, somebody downstream has it
 *   attention  stalled and recoverable — a person has to act to unstick it
 *   stopped    a dead end; nothing further happens to this record
 *   done       the whole chain completed
 */
export type StageHealth = "moving" | "attention" | "stopped" | "done";

/**
 * One row per stage string, replacing what used to be two parallel
 * Records (badge variant, next-action sentence) keyed by the same
 * strings. Parallel maps drift — a stage added to one and missed in the
 * other fails silently, falling back to "neutral" and an em dash — so
 * everything a stage means now lives on one line.
 *
 * `party` is who the record is waiting on when the caller has no actual
 * name to give. Callers that do know — the approvals inbox and the
 * lifecycle tracker both already load the users table — pass a person
 * through nextStep()'s context and it wins.
 */
type StageDescriptor = {
  variant: StageBadgeVariant;
  /** Index into LIFECYCLE_STEPS this stage sits at. */
  step: number;
  health: StageHealth;
  /** What happens next, in one sentence, active voice. */
  summary: string;
  party: string | null;
};

const STAGES: Record<string, StageDescriptor> = {
  "Draft": {
    variant: "neutral", step: 0, health: "attention", party: null,
    summary: "Submit it for approval when you're ready. Nobody else can see it yet.",
  },
  "Submitted": {
    variant: "info", step: 1, health: "moving", party: "the approval engine",
    summary: "Working out which approval rules apply and who they route to.",
  },
  "Pending approval": {
    variant: "info", step: 1, health: "moving", party: "an approver",
    summary: "Waiting for an approval decision.",
  },
  "Rejected — needs revision": {
    variant: "warning", step: 1, health: "attention", party: "the requestor",
    summary: "Revise the requisition and resubmit it. Approval restarts from the first step.",
  },
  "Rejected — closed": {
    variant: "destructive", step: 1, health: "stopped", party: null,
    summary: "Closed for good. A new requisition would have to be raised.",
  },
  "Cancelled": {
    variant: "neutral", step: 0, health: "stopped", party: null,
    summary: "Cancelled. Nothing further happens to it.",
  },
  "Approved — awaiting sourcing": {
    variant: "info", step: 2, health: "moving", party: "procurement",
    summary: "Invite vendors to quote, or issue a purchase order directly.",
  },
  "Sourcing": {
    variant: "info", step: 2, health: "moving", party: "the invited vendors",
    summary: "Waiting on quotations. Compare them, then select one to issue the purchase order.",
  },
  "Converted to PO": {
    variant: "info", step: 3, health: "moving", party: "procurement",
    summary: "The purchase order is being issued.",
  },
  "PO issued — awaiting fulfillment": {
    variant: "info", step: 4, health: "moving", party: "the vendor",
    summary: "Record the goods receipt or service acceptance once it arrives.",
  },
  "Partially fulfilled": {
    variant: "info", step: 4, health: "moving", party: "the vendor",
    summary: "Some of the order has arrived. Record the balance when the rest does.",
  },
  "Fulfilled — awaiting invoice": {
    variant: "info", step: 5, health: "moving", party: "the vendor",
    summary: "Everything has been received. Waiting for the vendor to invoice.",
  },
  "Invoice submitted": {
    variant: "info", step: 5, health: "moving", party: null,
    summary: "Matching the invoice against the purchase order and the receipt.",
  },
  "Invoice matched — awaiting payment approval": {
    variant: "info", step: 5, health: "moving", party: "finance",
    summary: "The invoice agrees with the order and the receipt. Finance approves it for payment.",
  },
  "Invoice exception — needs review": {
    variant: "warning", step: 5, health: "attention", party: "finance",
    summary: "The invoice doesn't agree with the order or the receipt. Approve it anyway with a reason, or dispute it with the vendor.",
  },
  "Invoice disputed": {
    variant: "destructive", step: 5, health: "stopped", party: "the vendor",
    summary: "Disputed with the vendor. Settle it with them directly — AWA has no resolution path yet.",
  },
  "Approved for payment": {
    variant: "info", step: 6, health: "moving", party: "finance",
    summary: "Waiting to be queued for release.",
  },
  "Payment queued": {
    variant: "info", step: 6, health: "moving", party: "finance",
    summary: "Send the payment, then confirm it here with its reference.",
  },
  "Payment failed": {
    variant: "destructive", step: 6, health: "attention", party: "finance",
    summary: "Retry with a corrected reference or payment method.",
  },
  "Paid": {
    variant: "success", step: 6, health: "done", party: null,
    summary: "Complete. Nothing further to do.",
  },
  "PO cancelled": {
    variant: "destructive", step: 3, health: "stopped", party: null,
    summary: "Cancelled. Nothing further happens to it.",
  },
};

/** Badge colour for a stage string returned by computeStage(). Falls back to neutral for anything unrecognized. */
export function stageBadgeVariant(stage: string): StageBadgeVariant {
  return STAGES[stage]?.variant ?? "neutral";
}

/** What happens next for a stage string returned by computeStage(). Falls back to an em dash for anything unrecognized. */
export function nextAction(stage: string): string {
  return STAGES[stage]?.summary ?? "—";
}

/** Where a stage sits on LIFECYCLE_STEPS, for the rail. Unknown stages report step 0 so the rail still renders rather than throwing. */
export function railPosition(stage: string): { step: number; health: StageHealth } {
  const descriptor = STAGES[stage];
  return { step: descriptor?.step ?? 0, health: descriptor?.health ?? "moving" };
}

export type NextStep = {
  /** What happens next, in one sentence. */
  summary: string;
  /**
   * The actual person holding this, when the caller knew one. Null is not
   * "nobody" — it means this caller didn't look the name up, and `party`
   * below is the honest fallback.
   */
  waitingOn: { name: string; role?: string | null } | null;
  /** Whose job this stage is in general — "the vendor", "finance". Worth showing only where a name isn't. */
  party: string | null;
  /** When it started waiting with them, so the UI can say how long it has been. */
  since: Date | null;
  /** What the person reading this can do about it right now, if anything. */
  action: { label: string; href: string } | null;
  /** True when this is a dead end and no action will move it. */
  terminal: boolean;
};

export type NextStepContext = {
  waitingOn?: { name: string; role?: string | null } | null;
  since?: Date | null;
  action?: { label: string; href: string } | null;
};

/**
 * The structured form of nextAction() — who has it, since when, and what
 * the reader can do — rather than one passive sentence.
 *
 * "Awaiting an approver's decision" was true and useless: the question a
 * requestor is actually asking is whose desk it is on and for how long,
 * and the answer to that is data most of these pages already load.
 *
 * `waitingOn` stays null unless the caller looked a name up, rather than
 * degrading to the generic party — "With an approver" underneath
 * "Waiting for an approval decision" is the same sentence twice and a
 * row of table height for nothing. `party` carries the generic phrasing
 * for callers that do want it.
 */
export function nextStep(stage: string, context: NextStepContext = {}): NextStep {
  const descriptor = STAGES[stage];

  return {
    summary: descriptor?.summary ?? "—",
    waitingOn: context.waitingOn ?? null,
    party: descriptor?.party ?? null,
    since: context.since ?? null,
    action: context.action ?? null,
    terminal: descriptor?.health === "stopped" || descriptor?.health === "done",
  };
}

/** "2 days", "5 hours" — how long something has been sitting where it is. Null when it hasn't been long enough to be worth saying. */
export function waitedFor(since: Date | null | undefined): string | null {
  if (!since) return null;
  const minutes = Math.floor((Date.now() - since.getTime()) / 60_000);
  if (minutes < 60) return null;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}
