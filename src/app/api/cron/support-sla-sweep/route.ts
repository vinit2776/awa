import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { withTenant } from "@/db/withTenant";
import { tenants as tenantsTable } from "@/db/schema";
import { sweepTenant, type SweepResult } from "@/db/supportEscalation";

/**
 * Vercel Cron (see vercel.json) hits this on a schedule — no user session, so
 * it authenticates with CRON_SECRET, exactly like
 * /api/cron/escalate-approvals. GET rather than POST because that is what
 * Vercel Cron issues.
 *
 * Iterates every tenant and sweeps each inside its own withTenant scope, so
 * RLS stays on throughout rather than reaching for the owner connection. The
 * tenants table itself carries no tenant_id, so listing it needs no elevated
 * access.
 *
 * Safe to call at any frequency, and safe to call twice: sweepTenant only ever
 * raises escalation_level and filters on the level being below what it would
 * set, so a replayed or manually-poked run finds nothing to redo and nobody
 * gets a duplicate email.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const allTenants = await db.select({ id: tenantsTable.id }).from(tenantsTable);
  const totals: SweepResult = { escalatedToL1: 0, escalatedToL2: 0, autoClosed: 0 };
  const perTenant: { tenantId: string; result: SweepResult }[] = [];

  for (const tenant of allTenants) {
    // One transaction per tenant: a failure sweeping one customer must not
    // abandon the rest, and a partial sweep is fine because the next run picks
    // up whatever was missed.
    try {
      const result = await withTenant(tenant.id, (tx) => sweepTenant(tx, tenant.id));
      totals.escalatedToL1 += result.escalatedToL1;
      totals.escalatedToL2 += result.escalatedToL2;
      totals.autoClosed += result.autoClosed;
      if (result.escalatedToL1 || result.escalatedToL2 || result.autoClosed) {
        perTenant.push({ tenantId: tenant.id, result });
      }
    } catch (error) {
      console.error(`[support-sla-sweep] tenant ${tenant.id} failed —`, error);
    }
  }

  return NextResponse.json({ ok: true, tenantsChecked: allTenants.length, totals, perTenant });
}
