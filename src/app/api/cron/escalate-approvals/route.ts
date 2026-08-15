import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { withTenant } from "@/db/withTenant";
import { tenants as tenantsTable } from "@/db/schema";
import { escalateStalePendingApprovals } from "@/db/escalation";

/**
 * Vercel Cron (see vercel.json) hits this on a schedule — no user
 * session, so it authenticates with CRON_SECRET instead of a cookie.
 * Vercel sends this same Authorization header automatically for
 * platform-scheduled invocations; the explicit check here is what stops
 * anyone else from triggering it by just requesting the URL.
 *
 * Iterates every tenant and processes each inside its own withTenant
 * scope — the tenants table itself has no RLS restricting which rows
 * are visible (same pattern the platform console already relies on), so
 * listing them needs no admin/RLS-bypass connection; only the
 * escalation work per tenant does, and that stays properly scoped.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const allTenants = await db.select().from(tenantsTable);
  let totalEscalated = 0;
  const results: { tenantId: string; escalated: number }[] = [];

  for (const tenant of allTenants) {
    if (tenant.escalationSlaHours <= 0) continue;
    const escalated = await withTenant(tenant.id, (tx) =>
      escalateStalePendingApprovals(tx, tenant.id, tenant.escalationSlaHours),
    );
    totalEscalated += escalated;
    if (escalated > 0) results.push({ tenantId: tenant.id, escalated });
  }

  return NextResponse.json({ ok: true, tenantsChecked: allTenants.length, totalEscalated, results });
}
