import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import {
  purchaseRequisitions as purchaseRequisitionsTable,
  requisitionApprovalRequirements as requirementsTable,
  approvalRules as approvalRulesTable,
  rfqs as rfqsTable,
  vendorQuotations as quotationsTable,
  purchaseOrders as purchaseOrdersTable,
  invoices as invoicesTable,
  paymentInstructions as paymentInstructionsTable,
  vendors as vendorsTable,
  users as usersTable,
} from "@/db/schema";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { LifecycleRail } from "@/components/ui/lifecycle-rail";
import { Info, PageHelp, Term } from "@/components/ui/help";
import { computeStage, approvalStepDetail } from "../stage";
import { LifecycleStatus } from "../LifecycleStatus";

// The payment_instructions enum, in the reader's words rather than the
// column's — the rail is the one place a requestor with no procurement
// vocabulary reads this record.
const PAYMENT_CAPTIONS: Record<string, string> = {
  queued: "Queued for release",
  released: "Sent",
  failed: "Failed — needs a retry",
};

export default async function LifecycleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { tenant } = await getCurrentUserAndTenant();

  const data = await withTenant(tenant.id, async (tx) => {
    const [requisition] = await tx.select().from(purchaseRequisitionsTable).where(eq(purchaseRequisitionsTable.id, id));
    if (!requisition) return null;

    const rfqRows = await tx.select().from(rfqsTable).where(eq(rfqsTable.requisitionId, id));
    const rfq = rfqRows[0];
    const quotations = rfq ? await tx.select().from(quotationsTable).where(eq(quotationsTable.rfqId, rfq.id)) : [];
    const [po] = await tx.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.requisitionId, id));
    const [invoice] = po ? await tx.select().from(invoicesTable).where(eq(invoicesTable.poId, po.id)) : [];
    const [payment] = invoice ? await tx.select().from(paymentInstructionsTable).where(eq(paymentInstructionsTable.invoiceId, invoice.id)) : [];
    const users = await tx.select().from(usersTable);
    const vendors = await tx.select().from(vendorsTable);
    const requirementRows = await tx.select().from(requirementsTable).where(eq(requirementsTable.requisitionId, id));
    const approvalRules = await tx.select().from(approvalRulesTable);

    return { requisition, rfq, quotations, po, invoice, payment, users, vendors, requirementRows, approvalRules };
  });

  if (!data) notFound();
  const { requisition, rfq, quotations, po, invoice, payment, users, vendors, requirementRows, approvalRules } = data;

  const userName = (id: string | null) => users.find((u) => u.id === id)?.fullName ?? "—";
  const vendorName = (id: string) => vendors.find((v) => v.id === id)?.name ?? "—";
  const stage = computeStage(requisition, rfq ? [rfq] : [], po, invoice, payment);
  const stepDetail = approvalStepDetail(requirementRows);
  const matchedRuleNames = [...new Set(requirementRows.filter((r) => r.sourceRuleId).map((r) => r.sourceRuleId!))]
    .map((ruleId) => approvalRules.find((r) => r.id === ruleId)?.name)
    .filter((name): name is string => !!name);

  // Who is actually holding this right now. Only the lowest-numbered
  // pending group is actionable — later groups exist as rows but nobody
  // is waiting on them yet, so naming one of those would be wrong.
  const pendingRequirements = requirementRows.filter((r) => r.status === "pending");
  const currentGroup = pendingRequirements.length ? Math.min(...pendingRequirements.map((r) => r.groupNo)) : null;
  const currentApprovers = pendingRequirements.filter((r) => r.groupNo === currentGroup);
  const waitingOn =
    requisition.status === "pending_approval" && currentApprovers.length > 0
      ? {
          name:
            currentApprovers.length === 1
              ? userName(currentApprovers[0].assignedUserId)
              : `${currentApprovers.length} approvers`,
        }
      : null;
  // actionableAt, not createdAt — a later group's row is stamped at
  // submission time, long before that group is waiting on anyone.
  const since = currentApprovers.length ? (currentApprovers[0].actionableAt ?? requisition.submittedAt) : null;

  // stepDetail is null for a single-step chain — "Step 1 of 1" isn't worth
  // saying — so it can't stand in for the caption on its own, or a pending
  // one-approver requisition reads as "Not started".
  const approvalCaption = ["approved", "converted_to_po"].includes(requisition.status)
    ? "Cleared"
    : requisition.status === "pending_approval" || requisition.status === "submitted"
      ? (stepDetail ?? "In progress")
      : requisition.status.startsWith("rejected")
        ? "Rejected"
        : "Not started";

  const captions = {
    requisition: `${userName(requisition.requestorId)} · ${requisition.totalEstimatedValue} ${requisition.currency}`,
    approval: approvalCaption,
    sourcing: quotations.length
      ? `${quotations.length} quotation${quotations.length === 1 ? "" : "s"}`
      : rfq
        ? "No quotations yet"
        : "Not started",
    purchase_order: po ? `${po.poNumber} · ${vendorName(po.vendorId)}` : "Not issued",
    receipt: po?.status === "fulfilled" ? "Complete" : po ? "Awaiting delivery" : "—",
    invoice: invoice ? invoice.invoiceNumber : "Not submitted",
    payment: payment
      ? PAYMENT_CAPTIONS[payment.status]
      : invoice?.status === "approved_for_payment"
        ? "Awaiting queue"
        : "—",
  };

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex flex-col gap-2">
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Lifecycle", href: "/dashboard/lifecycle" },
            { label: "Requisition lifecycle" },
          ]}
        />
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-serif text-lg text-foreground">Requisition lifecycle</h1>
            <p className="text-sm text-muted-foreground">
              Every stage this <Term name="requisition">requisition</Term> passes through, and where it has got
              to.
            </p>
          </div>
          <LifecycleStatus
            stage={stage}
            detail={stage === "Pending approval" ? stepDetail : undefined}
            waitingOn={waitingOn}
            since={since}
            className="shrink-0 items-end text-right"
          />
        </div>
      </div>

      <PageHelp
        id="lifecycle-detail"
        title="How to read this"
        steps={[
          "The rail below runs left to right through all seven stages. Green is done, orange is where it is now, grey is still to come.",
          "Nothing skips a stage. A requisition cannot be invoiced before it is received, or paid before it is matched.",
          "If it has stopped moving, the status on the right names who is holding it and for how long.",
        ]}
      />

      <div className="rounded-lg border border-border p-4">
        <LifecycleRail stage={stage} captions={captions} explain />
      </div>

      <dl className="flex flex-col gap-3 text-sm">
        <div>
          <dt className="font-medium">Approval</dt>
          <dd className="text-muted-foreground">
            {matchedRuleNames.length > 0 ? (
              <>
                Matched {matchedRuleNames.map((n) => `"${n}"`).join(", ")}
                <Info title="Approval rule" next="Admin › Approval rules shows every rule and what it covers.">
                  A standing instruction about who has to sign off, at what value, for which category or
                  department. More than one rule can apply to the same requisition.
                </Info>
              </>
            ) : (
              <>
                No approval rule matched this requisition, so it was approved automatically.
                <Info
                  title="Auto-approved"
                  next="An admin can close this gap by adding a rule that covers this value and category."
                >
                  When no rule matches, there is nobody to route the requisition to, so AWA approves it rather
                  than leaving it stuck forever.
                </Info>
              </>
            )}
          </dd>
        </div>

        {po && (
          <div>
            <dt className="font-medium">Purchase order</dt>
            <dd className="text-muted-foreground">
              {po.poNumber} · {vendorName(po.vendorId)} · {po.status.replace(/_/g, " ")}
              {po.status === "partially_fulfilled" && (
                <>
                  {" — "}
                  <Term name="partial-fulfilment">part of the order is still outstanding</Term>
                </>
              )}
            </dd>
          </div>
        )}

        {invoice && (
          <div>
            <dt className="font-medium">Invoice</dt>
            <dd className="text-muted-foreground">
              {invoice.invoiceNumber} · {invoice.status.replace(/_/g, " ")}
              {invoice.status === "exception" && (
                <>
                  {" — failed the "}
                  <Term name="three-way-match" />
                </>
              )}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
