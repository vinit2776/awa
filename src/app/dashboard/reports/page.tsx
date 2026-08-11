import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { getApprovalsReport } from "@/db/reports";

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
  const report = await withTenant(tenant.id, (tx) => getApprovalsReport(tx));

  // The demo/test data in this codebase is exclusively INR (see
  // db/schema.ts's default); a real multi-currency tenant would need
  // this report broken out per currency rather than summed together.
  const currency = "INR";
  const maxMonthly = Math.max(0, ...report.timeline.map((r) => r.value));
  const maxDept = Math.max(0, ...report.byDepartment.map((r) => r.value));

  return (
    <div className="flex flex-col gap-10 p-8">
      <div>
        <h1 className="font-serif text-lg text-foreground">Reports</h1>
        <p className="text-sm text-muted-foreground">Approvals — value, timeline, and department breakdown for {tenant.name}</p>
      </div>

      <div className="flex gap-8">
        <div>
          <p className="text-2xl font-medium tabular-nums">{formatValue(report.totalValue, currency)}</p>
          <p className="text-xs text-muted-foreground">Total value approved</p>
        </div>
        <div>
          <p className="text-2xl font-medium tabular-nums">{report.totalCount}</p>
          <p className="text-xs text-muted-foreground">Requisitions approved</p>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-serif text-base text-foreground">By month</h2>
        {report.timeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">No approved requisitions yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {report.timeline.map((r) => (
              <Bar key={r.month} label={monthLabel(r.month)} value={r.value} count={r.count} max={maxMonthly} currency={currency} />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-serif text-base text-foreground">By department</h2>
        {report.byDepartment.length === 0 ? (
          <p className="text-sm text-muted-foreground">No approved requisitions yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {report.byDepartment.map((r) => (
              <Bar key={r.departmentId ?? "none"} label={r.departmentName} value={r.value} count={r.count} max={maxDept} currency={currency} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
