import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import {
  purchaseRequisitions as purchaseRequisitionsTable,
  purchaseRequisitionLines as purchaseRequisitionLinesTable,
  requisitionApprovalRequirements as requirementsTable,
  approvalRules as approvalRulesTable,
  catalogItems as catalogItemsTable,
  rfqs as rfqsTable,
  vendorQuotations as quotationsTable,
  purchaseOrders as purchaseOrdersTable,
  invoices as invoicesTable,
  paymentInstructions as paymentInstructionsTable,
  vendors as vendorsTable,
  users as usersTable,
  departments as departmentsTable,
  costCenters as costCentersTable,
} from "@/db/schema";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { LifecycleRail } from "@/components/ui/lifecycle-rail";
import { Info, Term } from "@/components/ui/help";
import { computeStage, approvalStepDetail, PAYMENT_CAPTIONS } from "@/lib/lifecycle";
import { LifecycleStatus } from "@/components/ui/lifecycle-status";

/**
 * The requisition record — what a requestor opens to find out what
 * happened to the thing they asked for.
 *
 * This route did not exist before: /dashboard/requisitions/[id] had only
 * an /edit child, and the coordinator-facing tracker at
 * /dashboard/lifecycle/[id] was standing in for it, reachable only
 * through a nav item called "Lifecycle". The Queries inbox has been
 * linking here (queries/page.tsx ENTITY_HREF) and 404ing the whole time.
 */
export default async function RequisitionDetailPage({ params }: { params: Promise<{ id: string }> }) {
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
    const [payment] = invoice
      ? await tx.select().from(paymentInstructionsTable).where(eq(paymentInstructionsTable.invoiceId, invoice.id))
      : [];

    return {
      requisition,
      lines: await tx.select().from(purchaseRequisitionLinesTable).where(eq(purchaseRequisitionLinesTable.requisitionId, id)),
      catalogItems: await tx.select().from(catalogItemsTable),
      rfq,
      quotations,
      po,
      invoice,
      payment,
      users: await tx.select().from(usersTable),
      vendors: await tx.select().from(vendorsTable),
      departments: await tx.select().from(departmentsTable),
      costCenters: await tx.select().from(costCentersTable),
      requirementRows: await tx.select().from(requirementsTable).where(eq(requirementsTable.requisitionId, id)),
      approvalRules: await tx.select().from(approvalRulesTable),
    };
  });

  if (!data) notFound();
  const {
    requisition, lines, catalogItems, rfq, quotations, po, invoice, payment,
    users, vendors, departments, costCenters, requirementRows, approvalRules,
  } = data;

  const userName = (userId: string | null) => users.find((u) => u.id === userId)?.fullName ?? "—";
  const vendorName = (vendorId: string) => vendors.find((v) => v.id === vendorId)?.name ?? "—";
  const itemName = (itemId: string | null) => catalogItems.find((i) => i.id === itemId)?.name ?? null;
  const departmentName = departments.find((d) => d.id === requisition.departmentId)?.name ?? "—";
  const costCenterName = costCenters.find((c) => c.id === requisition.costCenterId)?.name ?? "—";

  const stage = computeStage(requisition, rfq ? [rfq] : [], po, invoice, payment);
  const stepDetail = approvalStepDetail(requirementRows);
  const matchedRuleNames = [...new Set(requirementRows.filter((r) => r.sourceRuleId).map((r) => r.sourceRuleId!))]
    .map((ruleId) => approvalRules.find((r) => r.id === ruleId)?.name)
    .filter((name): name is string => !!name);

  // Only the lowest-numbered pending group is actionable — later groups
  // exist as rows but nobody is waiting on them yet, so naming somebody
  // from one of those would be wrong.
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
            { label: "Requisitions", href: "/dashboard/requisitions" },
            { label: "Requisition" },
          ]}
        />
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-serif text-lg text-foreground">
              {requisition.totalEstimatedValue} {requisition.currency}
            </h1>
            <p className="text-sm text-muted-foreground">
              Raised by {userName(requisition.requestorId)} · {departmentName} · {costCenterName}
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

      <div className="rounded-lg border border-border p-4">
        <LifecycleRail stage={stage} captions={captions} explain />
      </div>

      {requisition.justification && (
        <p className="text-sm text-muted-foreground">&ldquo;{requisition.justification}&rdquo;</p>
      )}

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">What was asked for</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 font-normal">Item</th>
              <th className="py-2 font-normal">Type</th>
              <th className="py-2 font-normal">Qty</th>
              <th className="py-2 font-normal">
                <Term name="uom">UoM</Term>
              </th>
              <th className="py-2 font-normal">Unit price</th>
              <th className="py-2 font-normal">Line total</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id} className="border-b">
                <td className="py-2">{line.freeTextDescription ?? itemName(line.catalogItemId) ?? "—"}</td>
                <td className="py-2 capitalize">{line.fulfillmentType}</td>
                <td className="py-2">{line.quantity}</td>
                <td className="py-2">{line.uom}</td>
                <td className="py-2">{line.estimatedUnitPrice}</td>
                <td className="py-2">
                  {(Number(line.quantity) * Number(line.estimatedUnitPrice)).toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
