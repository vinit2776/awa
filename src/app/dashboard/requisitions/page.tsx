import Link from "next/link";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import {
  purchaseRequisitions as purchaseRequisitionsTable,
  requisitionApprovalRequirements as requirementsTable,
  departments as departmentsTable,
  costCenters as costCentersTable,
  requisitionStatus,
} from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { cn } from "@/lib/utils";
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

export default async function RequisitionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; sort?: string }>;
}) {
  const params = await searchParams;
  const { user, tenant } = await getCurrentUserAndTenant();

  const statusFilter = requisitionStatus.enumValues.includes(params.status as StatusValue)
    ? (params.status as StatusValue)
    : null;
  const sort: SortValue | null = params.sort === "status_asc" || params.sort === "status_desc" ? params.sort : null;

  const orderBy =
    sort === "status_asc"
      ? [asc(purchaseRequisitionsTable.status), desc(purchaseRequisitionsTable.createdAt)]
      : sort === "status_desc"
        ? [desc(purchaseRequisitionsTable.status), desc(purchaseRequisitionsTable.createdAt)]
        : [desc(purchaseRequisitionsTable.createdAt)];

  const [requisitions, departments, costCenters] = await withTenant(tenant.id, async (tx) => [
    await tx
      .select()
      .from(purchaseRequisitionsTable)
      .where(
        and(
          eq(purchaseRequisitionsTable.requestorId, user.id),
          ...(statusFilter ? [eq(purchaseRequisitionsTable.status, statusFilter)] : []),
        ),
      )
      .orderBy(...orderBy),
    await tx.select().from(departmentsTable),
    await tx.select().from(costCentersTable),
  ]);

  const nextSort: SortValue | null = sort === "status_asc" ? "status_desc" : sort === "status_desc" ? null : "status_asc";
  const sortHref = `?${new URLSearchParams({
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(nextSort ? { sort: nextSort } : {}),
  }).toString()}`;
  const clearFilterHref = sort ? `?${new URLSearchParams({ sort }).toString()}` : "/dashboard/requisitions";

  const rejectedIds = requisitions.filter((r) => r.status === "rejected_revisable" || r.status === "rejected_closed").map((r) => r.id);
  const rejectionReasons = rejectedIds.length
    ? await withTenant(tenant.id, (tx) =>
        tx
          .select({ requisitionId: requirementsTable.requisitionId, comment: requirementsTable.decisionComment, decidedAt: requirementsTable.decidedAt })
          .from(requirementsTable)
          .where(inArray(requirementsTable.requisitionId, rejectedIds)),
      )
    : [];
  const reasonFor = (requisitionId: string) =>
    rejectionReasons
      .filter((r) => r.requisitionId === requisitionId && r.comment)
      .sort((a, b) => (b.decidedAt?.getTime() ?? 0) - (a.decidedAt?.getTime() ?? 0))[0]?.comment ?? null;

  const departmentName = (id: string | null) => departments.find((d) => d.id === id)?.name ?? "—";
  const costCenterName = (id: string | null) => costCenters.find((c) => c.id === id)?.name ?? "—";

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex flex-col gap-2">
        <Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "My requests" }]} />
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-serif text-lg text-foreground">My requests</h1>
            <p className="text-sm text-muted-foreground">
              {requisitions.length} in {tenant.name}
              {statusFilter && ` matching "${humanizeStatus(statusFilter)}"`}
            </p>
          </div>
          <Link href="/dashboard/requisitions/new" className={cn(buttonVariants())}>
            New requisition
          </Link>
        </div>
      </div>

      <form method="GET" className="flex items-end gap-2">
        {sort && <input type="hidden" name="sort" value={sort} />}
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
          <Link href={clearFilterHref} className="text-xs text-muted-foreground underline">
            Clear
          </Link>
        )}
      </form>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 font-normal">Created</th>
            <th className="py-2 font-normal">Department</th>
            <th className="py-2 font-normal">Cost center</th>
            <th className="py-2 font-normal">Total</th>
            <th className="py-2 font-normal">
              <Link href={sortHref} className="hover:text-foreground">
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
              <td colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                No requisitions match this filter.
              </td>
            </tr>
          )}
          {requisitions.map((r) => {
            const days = pendingDays(r.submittedAt);
            const showPending = days !== null && (r.status === "submitted" || r.status === "pending_approval");
            const reason = r.status === "rejected_revisable" || r.status === "rejected_closed" ? reasonFor(r.id) : null;
            return (
              <tr key={r.id} className="border-b align-top">
                <td className="py-2">{r.createdAt.toISOString().slice(0, 10)}</td>
                <td className="py-2">{departmentName(r.departmentId)}</td>
                <td className="py-2">{costCenterName(r.costCenterId)}</td>
                <td className="py-2">{r.totalEstimatedValue} {r.currency}</td>
                <td className="py-2">
                  {r.status}
                  {showPending && <span className="text-muted-foreground"> · {days} day{days === 1 ? "" : "s"}</span>}
                  {reason && <p className="mt-0.5 max-w-xs text-xs text-muted-foreground">{reason}</p>}
                </td>
                <td className="py-2">
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
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
