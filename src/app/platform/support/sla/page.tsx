import Link from "next/link";
import { redirect } from "next/navigation";
import { PlatformAdminAccessError } from "@/db/platformSession";
import { getCurrentSupportAgent } from "@/db/supportDesk";
import { db } from "@/db/client";
import { withTenant } from "@/db/withTenant";
import { supportSlaOverrides, supportSlaPolicies, tenants as tenantsTable } from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { removeOverride, saveOverride } from "./actions";

const TYPES = ["bug", "question", "feature_request", "feedback"] as const;
const PRIORITIES = ["urgent", "high", "normal", "low"] as const;

function humanMinutes(minutes: number | null): string {
  if (minutes === null) return "no target";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

export default async function SlaOverridesPage() {
  try {
    await getCurrentSupportAgent();
  } catch (error) {
    if (error instanceof PlatformAdminAccessError) redirect("/platform");
    throw error;
  }

  const tenants = await db
    .select({ id: tenantsTable.id, name: tenantsTable.name, slug: tenantsTable.slug })
    .from(tenantsTable)
    .orderBy(tenantsTable.name);
  const policies = await db.select().from(supportSlaPolicies);

  // One withTenant per customer: support_sla_overrides is tenant-scoped, so
  // there is no single query that reads them all without bypassing RLS — and
  // the roster of customers is small enough that per-tenant reads are the right
  // trade for keeping the isolation model intact.
  const overridesByTenant = new Map<string, (typeof supportSlaOverrides.$inferSelect)[]>();
  for (const tenant of tenants) {
    const rows = await withTenant(tenant.id, (tx) => tx.select().from(supportSlaOverrides));
    if (rows.length > 0) overridesByTenant.set(tenant.id, rows);
  }

  return (
    <div className="flex flex-1 flex-col gap-5 p-6">
      <div>
        <Link href="/platform/support" className="text-xs text-muted-foreground hover:text-foreground">
          ← Support queue
        </Link>
        <h1 className="mt-1 font-serif text-xl">SLA targets</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          The standard policy applies to every customer. An override replaces it for one customer only — use it
          when an SLA has actually been negotiated, not to paper over a backlog.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <h2 className="border-b border-border px-4 py-2.5 text-xs uppercase tracking-wide text-muted-foreground">
          Standard policy
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-4 py-2 font-normal">Type</th>
              {PRIORITIES.map((p) => (
                <th key={p} className="px-4 py-2 font-normal capitalize">
                  {p}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TYPES.map((type) => (
              <tr key={type} className="border-b border-border last:border-b-0">
                <td className="px-4 py-2 font-medium">{type.replace("_", " ")}</td>
                {PRIORITIES.map((priority) => {
                  const policy = policies.find((p) => p.ticketType === type && p.priority === priority);
                  return (
                    <td key={priority} className="px-4 py-2 tabular-nums text-muted-foreground">
                      {policy
                        ? `${humanMinutes(policy.firstResponseMinutes)} / ${humanMinutes(policy.resolutionMinutes)}`
                        : "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          First response / resolution. Feature requests and feedback carry no resolution target on purpose — a
          backlog item has no honest one, and inventing it would make every such ticket a permanent breach.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Per-customer overrides</h2>

        {tenants.map((tenant) => {
          const overrides = overridesByTenant.get(tenant.id) ?? [];
          return (
            <div key={tenant.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <p className="text-sm font-medium">{tenant.name}</p>
                <span className="font-mono text-xs text-muted-foreground">{tenant.slug}</span>
                {overrides.length === 0 && (
                  <span className="text-xs text-muted-foreground">— on the standard policy</span>
                )}
              </div>

              {overrides.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1.5">
                  {overrides.map((o) => (
                    <li key={o.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{o.ticketType.replace("_", " ")}</span>
                      <span className="text-muted-foreground">/ {o.priority}</span>
                      <span className="tabular-nums">
                        {humanMinutes(o.firstResponseMinutes)} / {humanMinutes(o.resolutionMinutes)}
                      </span>
                      <form action={removeOverride} className="ml-auto">
                        <input type="hidden" name="tenantId" value={tenant.id} />
                        <input type="hidden" name="overrideId" value={o.id} />
                        <button
                          type="submit"
                          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-xs")}
                        >
                          Remove
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}

              <form action={saveOverride} className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
                <input type="hidden" name="tenantId" value={tenant.id} />
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Type</span>
                  <select name="ticketType" className="rounded-lg border border-input bg-background px-2 py-1.5 text-sm">
                    {TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Priority</span>
                  <select name="priority" className="rounded-lg border border-input bg-background px-2 py-1.5 text-sm">
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">First response (min)</span>
                  <input
                    name="firstResponseMinutes"
                    type="number"
                    min={1}
                    required
                    className="w-32 rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Resolution (min, blank = none)</span>
                  <input
                    name="resolutionMinutes"
                    type="number"
                    min={1}
                    className="w-40 rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
                  />
                </label>
                <button type="submit" className={cn(buttonVariants({ size: "sm" }))}>
                  Save override
                </button>
              </form>
            </div>
          );
        })}
      </div>
    </div>
  );
}
