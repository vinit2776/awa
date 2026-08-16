import { and, eq } from "drizzle-orm";
import type { db } from "./client";
import { getCurrentUserAndTenant } from "./session";
import { withTenant } from "./withTenant";
import { roles, userRoles } from "./schema";

/**
 * A tenant with nobody holding "tenant_admin" yet is in bootstrap state —
 * gating admin access strictly would mean nobody could ever reach the
 * Users page to grant the first one. Same "zero eligible ⇒ don't get
 * stuck" reasoning as resolveApprovals's zero-approver auto-approve path
 * (db/approvals.ts) — access stays open until at least one admin exists.
 */
export async function isTenantAdmin(tx: typeof db, tenantId: string, userId: string): Promise<boolean> {
  const admins = await tx
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(and(eq(userRoles.tenantId, tenantId), eq(roles.tenantId, tenantId), eq(roles.key, "tenant_admin")));

  if (admins.length === 0) return true;
  return admins.some((a) => a.userId === userId);
}

/**
 * Drop-in replacement for getCurrentUserAndTenant() at the top of any
 * admin-only server action — same return shape, plus the tenant_admin
 * check. Throws rather than redirecting since these only ever run as
 * form actions off a page a non-admin shouldn't have been able to reach
 * in the first place; this is the actual enforcement boundary, the admin
 * layout's check is only the friendlier UI-level one.
 */
export async function requireTenantAdmin() {
  const { user, tenant } = await getCurrentUserAndTenant();
  const allowed = await withTenant(tenant.id, (tx) => isTenantAdmin(tx, tenant.id, user.id));
  if (!allowed) {
    throw new Error(`${user.email} does not hold the Tenant admin role and cannot perform this action.`);
  }
  return { user, tenant };
}
