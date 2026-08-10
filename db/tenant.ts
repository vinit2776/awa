import { and, eq } from "drizzle-orm";
import { adminDb } from "./adminClient";
import { tenants, users } from "./schema";

export class TenantLinkError extends Error {}

/**
 * Resolves a WorkOS sign-in to our internal tenant/user records, linking
 * on first sign-in. Deliberately uses adminDb (owner connection, bypasses
 * RLS) — this is the one bootstrap operation that has to run before we
 * know which tenant's RLS scope applies at all.
 *
 * Tenant creation is never automatic here — a platform admin links a
 * tenants row to a WorkOS organization as a deliberate onboarding step
 * (§02). A users row must already exist too (pre-provisioned, status
 * 'invited') — this only flips it to 'active' and records the WorkOS
 * user id against it. There is no self-serve signup path yet.
 */
export async function linkUserOnSignIn(params: {
  workosUserId: string;
  workosOrganizationId: string | undefined;
  email: string;
}) {
  const [alreadyLinked] = await adminDb
    .select()
    .from(users)
    .where(eq(users.workosUserId, params.workosUserId))
    .limit(1);
  if (alreadyLinked) return alreadyLinked;

  if (!params.workosOrganizationId) {
    throw new TenantLinkError(
      "This WorkOS session has no organization — sign-in must happen within an organization context.",
    );
  }

  const [tenant] = await adminDb
    .select()
    .from(tenants)
    .where(eq(tenants.workosOrganizationId, params.workosOrganizationId))
    .limit(1);
  if (!tenant) {
    throw new TenantLinkError(
      `No tenant is linked to WorkOS organization ${params.workosOrganizationId} yet — a platform admin needs to link it first.`,
    );
  }

  const [pending] = await adminDb
    .select()
    .from(users)
    .where(and(eq(users.tenantId, tenant.id), eq(users.email, params.email)))
    .limit(1);
  if (!pending) {
    throw new TenantLinkError(
      `No invited user record for ${params.email} in tenant ${tenant.slug} — ask an admin to add them first.`,
    );
  }

  const [linked] = await adminDb
    .update(users)
    .set({ workosUserId: params.workosUserId, status: "active" })
    .where(eq(users.id, pending.id))
    .returning();

  return linked;
}
