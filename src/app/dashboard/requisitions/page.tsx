import Link from "next/link";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { getRequisitionDocumentUrl } from "@/db/documentStorage";
import {
  purchaseRequisitions as purchaseRequisitionsTable,
  purchaseRequisitionLines as purchaseRequisitionLinesTable,
  catalogItems as catalogItemsTable,
  requisitionApprovalRequirements as requirementsTable,
  departments as departmentsTable,
  costCenters as costCentersTable,
  users as usersTable,
  rfqs as rfqsTable,
  purchaseOrders as purchaseOrdersTable,
  invoices as invoicesTable,
  paymentInstructions as paymentInstructionsTable,
  requisitionStatus,
} from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Info } from "@/components/ui/help";
import { cn } from "@/lib/utils";
import { computeStage, approvalStepDetail } from "@/lib/lifecycle";
import { requisitionLabel } from "@/lib/requisitionSummary";
import { LifecycleStatus } from "@/components/ui/lifecycle-status";
import { submitRequisition } from "./actions";

function pendingDays(submittedAt: Date | null): number | null {
  if (!submittedAt) return null;
  return Math.floor((Date.now() - submittedAt.getTime()) / 86_400_000);
}

function humanizeStatus(status: string): string {
  return status.replace(/_/g, " ");
}

type StatusValue = (typeof requisitionStatus.enumValues)[number];
type SortValue = "status_asc" | "status_desc";
type ScopeValue = "mine" | "all";

/**
 * The one requisition list.
 *
 * "Everyone's" used to be a separate page at /dashboard/lifecycle with
 * its own nav item — the same records, the same stage column, differing
 * only in whether a requestorId filter was applied. Two nav entries for
 * one table taught every new user that there were two kinds of
 * requisition. It is a filter, so it is now a filter.
 */
export default async function RequisitionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; sort?: string; scope?: string }>;
}) {
  const params = await searchParams;
  const { user, tenant } = await getCurrentUserAndTenant();

  const statusFilter = requisitionStatus.enumValues.includes(params.status as StatusValue)
    ? (params.status as StatusValue)
    : null;
  const sort: SortValue | null = params.sort === "status_asc" || params.sort === "status_desc" ? params.sort : null;
  const scope: ScopeValue = params.scope === "all" ? "all" : "mine";

  const orderBy =
    sort === "status_asc"
      ? [asc(purchaseRequisitionsTable.status), desc(purchaseRequisitionsTable.createdAt)]
      : sort === "status_desc"
        ? [desc(purchaseRequisitionsTable.status), desc(purchaseRequisitionsTable.createdAt)]
        : [desc(purchaseRequisitionsTable.createdAt)];

  const [requisitions, departments, costCenters, users] = await withTenant(tenant.id, async (tx) => [
    await tx
      .select()
      .from(purchaseRequisitionsTable)
      .where(
        and(
          // RLS already scopes this to the tenant; this narrows it to the
          // reader. Dropping it is the whole of what "Everyone's" means.
          ...(scope === "mine" ? [eq(purchaseRequisitionsTable.requestorId, user.id)] : []),
          ...(statusFilter ? [eq(purchaseRequisitionsTable.status, statusFilter)] : []),
        ),
      )
      .orderBy(...orderBy),
    await tx.select().from(departmentsTable),
    await tx.select().from(costCentersTable),
    await tx.select().from(usersTable),
  ]);

  const nextSort: SortValue | null = sort === "status_asc" ? "status_desc" : sort === "status_desc" ? null : "status_asc";
  const queryWith = (overrides: Record<string, string | null>) => {
    const base: Record<string, string> = {
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(sort ? { sort } : {}),
      ...(scope === "all" ? { scope } : {}),
    };
    for (const [key, value] of Object.entries(overrides)) {
      if (value === null) delete base[key];
      else base[key] = value;
    }
    const query = new URLSearchParams(base).toString();
    return query ? `?${query}` : "/dashboard/requisitions";
  };

  const allRequisitionIds = requisitions.map((r) => r.id);
  const requirementRows = allRequisitionIds.length
    ? await withTenant(tenant.id, (tx) => tx.select().from(requirementsTable).where(inArray(requirementsTable.requisitionId, allRequisitionIds)))
    : [];
  const reasonFor = (requisitionId: string) =>
    requirementRows
      .filter((r) => r.requisitionId === requisitionId && r.status === "rejected" && r.decisionComment)
      .sort((a, b) => (b.decidedAt?.getTime() ?? 0) - (a.decidedAt?.getTime() ?? 0))[0]?.decisionComment ?? null;
  const stepDetailFor = (requisitionId: string) => approvalStepDetail(requirementRows.filter((r) => r.requisitionId === requisitionId));

  // What each requisition is for. Without this the table says who, when,
  // how much and what stage — everything except the thing being bought.
  const [lines, catalogItems] = allRequisitionIds.length
    ? await withTenant(tenant.id, async (tx) => [
        await tx.select().from(purchaseRequisitionLinesTable).where(inArray(purchaseRequisitionLinesTable.requisitionId, allRequisitionIds)),
        await tx.select().from(catalogItemsTable),
      ])
    : [[], []];

  const documentUrls = new Map(
    await Promise.all(
      requisitions
        .filter((r) => r.sourceDocumentKey)
        .map(async (r) => [r.id, await getRequisitionDocumentUrl(r.sourceDocumentKey!)] as const),
    ),
  );

  const requisitionIds = requisitions.map((r) => r.id);
  const [rfqRows, poRows] = requisitionIds.length
    ? await withTenant(tenant.id, async (tx) => [
        await tx.select().from(rfqsTable).where(inArray(rfqsTable.requisitionId, requisitionIds)),
        await tx.select().from(purchaseOrdersTable).where(inArray(purchaseOrdersTable.requisitionId, requisitionIds)),
      ])
    : [[], []];
  const poIds = poRows.map((p) => p.id);
  const invoiceRows = poIds.length
    ? await withTenant(tenant.id, (tx) => tx.select().from(invoicesTable).where(inArray(invoicesTable.poId, poIds)))
    : [];
  const invoiceIds = invoiceRows.map((i) => i.id);
  const paymentRows = invoiceIds.length
    ? await withTenant(tenant.id, (tx) => tx.select().from(paymentInstructionsTable).where(inArray(paymentInstructionsTable.invoiceId, invoiceIds)))
    : [];

  const stageFor = (r: (typeof requisitions)[number]) => {
    const rfqsForReq = rfqRows.filter((x) => x.requisitionId === r.id);
    const po = poRows.find((x) => x.requisitionId === r.id);
    const invoice = po ? invoiceRows.find((x) => x.poId === po.id) : undefined;
    const payment = invoice ? paymentRows.find((x) => x.invoiceId === invoice.id) : undefined;
    return computeStage(r, rfqsForReq, po, invoice, payment);
  };

  const departmentName = (id: string | null) => departments.find((d) => d.id === id)?.name ?? "—";
  const costCenterName = (id: string | null) => costCenters.find((c) => c.id === id)?.name ?? "—";
  const requestorName = (id: string) => users.find((u) => u.id === id)?.fullName ?? "—";
  // A requisition has no number and no title — what it is for is the only
  // thing anyone can recognise it by.
  const labelFor = (r: { id: string }) =>
    requisitionLabel(lines.filter((l) => l.requisitionId === r.id), catalogItems);

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex flex-col gap-2">
        <Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Requisitions" }]} />
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-serif text-lg text-foreground">Requisitions</h1>
            <p className="text-sm text-muted-foreground">
              {scope === "mine"
                ? "Everything you've asked to buy, and where each one has got to."
                : `Every requisition in ${tenant.name}, wherever it currently is.`}
            </p>
          </div>
          <Link href="/dashboard/requisitions/new" className={cn(buttonVariants())}>
            New requisition
          </Link>
        </div>
      </div>

      <form method="GET" className="flex flex-wrap items-end gap-2">
        {sort && <input type="hidden" name="sort" value={sort} />}
        <div className="flex flex-col gap-1">
          <label htmlFor="scope" className="text-xs text-muted-foreground">
            Show
            <Info title="Whose requisitions" next="Switching to everyone's is how you answer “what happened to my order?” for a colleague.">
              Mine lists only requisitions you raised. Everyone&apos;s lists every requisition in your
              organisation, whoever raised it.
            </Info>
          </label>
          <select id="scope" name="scope" defaultValue={scope} className="h-8 rounded-md border px-2 text-sm">
            <option value="mine">Mine</option>
            <option value="all">Everyone&apos;s</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="status" className="text-xs text-muted-foreground">Status</label>
          <select id="status" name="status" defaultValue={statusFilter ?? ""} className="h-8 rounded-md border px-2 text-sm">
            <option value="">All statuses</option>
            {requisitionStatus.enumValues.map((s) => (
              <option key={s} value={s}>{humanizeStatus(s)}</option>
            ))}
          </select>
        </div>
        <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Filter
        </button>
        {statusFilter && (
          <Link href={queryWith({ status: null })} className="text-xs text-muted-foreground underline">
            Clear
          </Link>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {requisitions.length} shown
        </span>
      </form>

      {/* Eight columns don't fit a laptop once "For" is in. The table
          scrolls inside its own container rather than pushing the page
          sideways. */}
      <div className="overflow-x-auto">
      <table className="w-full min-w-3xl text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 pr-4 font-normal whitespace-nowrap">Created</th>
            <th className="py-2 pr-4 font-normal">For</th>
            {scope === "all" && <th className="py-2 pr-4 font-normal">Requestor</th>}
            <th className="py-2 pr-4 font-normal">Department</th>
            <th className="py-2 pr-4 font-normal whitespace-nowrap">Cost center</th>
            <th className="py-2 pr-4 font-normal">Total</th>
            <th className="py-2 pr-4 font-normal">
              <Link href={queryWith({ sort: nextSort })} className="hover:text-foreground">
                Status
                {sort === "status_asc" && " ▲"}
                {sort === "status_desc" && " ▼"}
              </Link>
            </th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {requisitions.length === 0 && (
            <tr>
              <td colSpan={scope === "all" ? 8 : 7} className="py-6 text-center text-sm text-muted-foreground">
                {statusFilter
                  ? "No requisitions match this filter."
                  : scope === "mine"
                    ? "You haven't raised a requisition yet. “New requisition” starts one."
                    : "Nobody has raised a requisition yet."}
              </td>
            </tr>
          )}
          {requisitions.map((r) => {
            const days = pendingDays(r.submittedAt);
            const showPending = days !== null && (r.status === "submitted" || r.status === "pending_approval");
            const reason = r.status === "rejected_revisable" || r.status === "rejected_closed" ? reasonFor(r.id) : null;
            const stage = stageFor(r);
            return (
              <tr key={r.id} className="border-b align-top">
                <td className="py-2 pr-4 whitespace-nowrap">{r.createdAt.toISOString().slice(0, 10)}</td>
                <td className="py-2 pr-4">
                  <Link href={`/dashboard/requisitions/${r.id}`} className="font-medium hover:underline">
                    {labelFor(r)}
                  </Link>
                </td>
                {scope === "all" && <td className="py-2 pr-4 whitespace-nowrap">{requestorName(r.requestorId)}</td>}
                <td className="py-2 pr-4">{departmentName(r.departmentId)}</td>
                <td className="py-2 pr-4">{costCenterName(r.costCenterId)}</td>
                <td className="py-2 pr-4">{r.totalEstimatedValue} {r.currency}</td>
                <td className="py-2 pr-4">
                  <LifecycleStatus stage={stage} detail={stage === "Pending approval" ? stepDetailFor(r.id) : undefined} />
                  {showPending && <span className="text-muted-foreground">{days} day{days === 1 ? "" : "s"} pending</span>}
                  {reason && <p className="mt-0.5 max-w-xs text-xs text-muted-foreground">{reason}</p>}
                </td>
                <td className="flex flex-wrap items-center gap-2 py-2">
                  <Link href={`/dashboard/requisitions/${r.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                    Open
                  </Link>
                  {r.status === "draft" && (
                    <form action={submitRequisition}>
                      <input type="hidden" name="requisitionId" value={r.id} />
                      <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                        Submit
                      </button>
                    </form>
                  )}
                  {r.status === "rejected_revisable" && (
                    <Link href={`/dashboard/requisitions/${r.id}/edit`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                      Revise
                    </Link>
                  )}
                  {documentUrls.has(r.id) && (
                    <a
                      href={documentUrls.get(r.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-muted-foreground underline"
                    >
                      View document
                    </a>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}
