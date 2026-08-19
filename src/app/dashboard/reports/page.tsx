import Link from "next/link";
import { eq } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { getApprovalsReport } from "@/db/reports";
import { purchaseRequisitions as purchaseRequisitionsTable } from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { EmptyState } from "@/components/ui/empty-state";
import { Info } from "@/components/ui/help";
import { cn } from "@/lib/utils";

function formatValue(value: number, currency: string) {
  return `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function monthLabel(month: string) {
  const [year, m] = month.split("-");
  return new Date(Number(year), Number(m) - 1, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function Bar({ label, value, count, max, currency }: { label: string; value: number; count: number; max: number; currency: string }) {
  const width = max > 0 ? Math.max((value / max) * 100, value > 0 ? 2 : 0) : 0;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-32 shrink-0 truncate text-muted-foreground">{label}</span>
      <div className="flex-1">
        <div className="h-4 rounded-sm bg-sidebar-primary/15" style={{ width: `${width}%` }} />
      </div>
      <span className="w-40 shrink-0 text-right tabular-nums">
        {formatValue(value, currency)} <span className="text-muted-foreground">· {count}</span>
      </span>
    </div>
  );
}

export default async function ReportsPage() {
  const { tenant } = await getCurrentUserAndTenant();
  const [report, inApproval] = await withTenant(tenant.id, async (tx) => [
    await getApprovalsReport(tx),
    // Only read to point somewhere useful when nothing has been approved
    // yet, which is every tenant's first weeks.
    await tx.select().from(purchaseRequisitionsTable).where(eq(purchaseRequisitionsTable.status, "pending_approval")),
  ]);

  // The demo/test data in this codebase is exclusively INR (see
  // db/schema.ts's default); a real multi-currency tenant would need
  // this report broken out per currency rather than summed together.
  const currency = "INR";
  const maxMonthly = Math.max(0, ...report.timeline.map((r) => r.value));
  const maxDept = Math.max(0, ...report.byDepartment.map((r) => r.value));

  return (
    <div className="flex flex-col gap-10 p-8">
      <div className="flex flex-col gap-2">
        <Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Reports" }]} />
        <div>
          <h1 className="font-serif text-lg text-foreground">Reports</h1>
          <p className="text-sm text-muted-foreground">
            What {tenant.name} has committed to spend, once approved — by month and by department.
          </p>
        </div>
      </div>

      {report.totalCount === 0 ? (
        <EmptyState title="Nothing approved yet">
          These figures count requisitions that have cleared every approver, so they start moving the first time
          something is approved.{" "}
          {inApproval.length > 0 ? (
            <>
              {inApproval.length} {inApproval.length === 1 ? "is" : "are"} in approval right now.
            </>
          ) : (
            <>Nothing is in approval either.</>
          )}
          {inApproval.length > 0 && (
            <div className="mt-3">
              <Link
                href="/dashboard/requisitions?scope=all&status=pending_approval"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              >
                See what&apos;s in approval
              </Link>
            </div>
          )}
        </EmptyState>
      ) : (
        <>
          <div className="flex gap-8">
            <div>
              <p className="text-2xl font-medium tabular-nums">{formatValue(report.totalValue, currency)}</p>
              <p className="text-xs text-muted-foreground">
                Total value approved
                <Info
                  title="Total value approved"
                  next="It is what was committed, not what has been paid — see Payments for money actually sent."
                >
                  The estimated value of every requisition that has cleared its full approval chain. Rejected and
                  still-pending requisitions are not counted.
                </Info>
              </p>
            </div>
            <div>
              <p className="text-2xl font-medium tabular-nums">{report.totalCount}</p>
              <p className="text-xs text-muted-foreground">Requisitions approved</p>
            </div>
          </div>

          <section className="flex flex-col gap-3">
            <h2 className="font-serif text-base text-foreground">By month</h2>
            <div className="flex flex-col gap-2">
              {report.timeline.map((r) => (
                <Bar key={r.month} label={monthLabel(r.month)} value={r.value} count={r.count} max={maxMonthly} currency={currency} />
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="font-serif text-base text-foreground">By department</h2>
            <div className="flex flex-col gap-2">
              {report.byDepartment.map((r) => (
                <Bar key={r.departmentId ?? "none"} label={r.departmentName} value={r.value} count={r.count} max={maxDept} currency={currency} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
