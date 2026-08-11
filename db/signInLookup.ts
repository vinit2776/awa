import { eq } from "drizzle-orm";
import { adminDb } from "./adminClient";
import { isPlatformAdminEmail } from "./platformAdmins";
import { tenants, users } from "./schema";

export type SignInTarget = { tenantId: string; tenantName: string; organizationId: string };

/**
 * getSignInUrl() needs an explicit organizationId up front to produce an
 * organization-scoped WorkOS session — without one, authenticateWithCode
 * comes back with no organizationId at all, and linkUserOnSignIn throws
 * "This WorkOS session has no organization" (a real gap: the app's
 * sign-in button called getSignInUrl() with no options since Sprint 1,
 * meaning a real tenant user could never actually complete sign-in
 * through it — only surfaced once someone actually tried, not caught by
 * anything short of a live WorkOS round trip).
 *
 * users is unique on (tenant_id, email), not email alone — the same
 * person can legitimately be pre-provisioned under more than one tenant
 * (a consultant working with several customers of this platform), same
 * shape as vendor_users. A platform admin has no tenant/organization at
 * all and takes priority over any tenant match, matching
 * db/tenant.ts#linkUserOnSignIn's own platform-admin skip.
 */
export async function resolveSignInTargets(email: string): Promise<{ isPlatformAdmin: boolean; tenants: SignInTarget[] }> {
  const normalized = email.trim().toLowerCase();
  const isPlatformAdmin = await isPlatformAdminEmail(normalized);

  const rows = await adminDb
    .select({ tenantId: tenants.id, tenantName: tenants.name, organizationId: tenants.workosOrganizationId })
    .from(users)
    .innerJoin(tenants, eq(users.tenantId, tenants.id))
    .where(eq(users.email, normalized));

  const withOrg = rows.filter((r): r is SignInTarget => r.organizationId !== null);
  return { isPlatformAdmin, tenants: withOrg };
}
