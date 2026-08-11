import { and, eq, isNull } from "drizzle-orm";
import type { db } from "./client";
import { logAction } from "./audit";
import { isEmailAllowedForTenant } from "./domainRestriction";
import { tenants, users, userRoles } from "./schema";

/**
 * The provisioning step db/tenant.ts#linkUserOnSignIn has always assumed
 * existed — a users row, status 'invited', matched by email at sign-in
 * time — but nothing in the app actually created one until now (found
 * while building domain restriction in S14). Checks the same domain
 * restriction JIT linking enforces, at invite time instead of only at
 * sign-in time, so an admin gets a clear error immediately rather than
 * the invited person hitting a rejected sign-in days later.
 */
export async function inviteUser(
  tx: typeof db,
  tenantId: string,
  actorUserId: string,
  params: { email: string; fullName: string },
): Promise<{ error?: string; userId?: string }> {
  const email = params.email.trim().toLowerCase();
  const fullName = params.fullName.trim();
  if (!email || !fullName) return { error: "Name and email are required." };

  const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant) return { error: "Tenant not found." };

  if (!isEmailAllowedForTenant(tenant.allowedEmailDomains, email)) {
    return { error: `${email} isn't on an allowed domain for this tenant (${tenant.allowedEmailDomains.join(", ")}).` };
  }

  try {
    // Nested transaction (savepoint), not a plain try/catch around the
    // insert directly on `tx`: once a statement fails, Postgres marks
    // the *whole* enclosing transaction aborted — every later statement
    // on the same connection fails too, "current transaction is aborted"
    // — even though the JS exception itself is caught fine. Without the
    // savepoint, logAction below (and whatever the caller does next in
    // the same withTenant() transaction) would silently fail too.
    const created = await tx.transaction(async (tx2) => {
      const [row] = await tx2.insert(users).values({ tenantId, email, fullName, status: "invited" }).returning();
      // logAction expects `typeof db` (needs $client); a nested
      // tx.transaction() callback's savepoint handle is typed without
      // it, the same type-vs-runtime gap withTenant.ts already papers
      // over with this exact cast.
      await logAction(tx2 as unknown as typeof db, {
        tenantId,
        actorUserId,
        action: "user.invited",
        entityType: "user",
        entityId: row.id,
        metadata: { email },
      });
      return row;
    });
    return { userId: created.id };
  } catch (err) {
    // drizzle-orm wraps the real PostgresError (which carries .code) in
    // DrizzleQueryError#cause — it's not on the top-level error itself.
    const cause = err instanceof Error ? err.cause : undefined;
    if (cause && typeof cause === "object" && "code" in cause && cause.code === "23505") {
      return { error: `${email} has already been invited to this tenant.` };
    }
    throw err;
  }
}

/**
 * Found live (S: admin console dogfooding): assigning a role has no
 * duplicate guard, so two clicks on "Assign" — or two admins racing on
 * the same user — silently create identical user_roles rows. Checked
 * here rather than as a DB unique constraint: scope_id is NULL for
 * global-scoped assignments, and Postgres treats every NULL as distinct
 * from every other NULL, so a plain UNIQUE(tenant_id, user_id, role_id,
 * scope_type, scope_id) wouldn't actually catch the global case that
 * caused this in the first place.
 */
export async function assignUserRole(
  tx: typeof db,
  tenantId: string,
  actorUserId: string,
  params: { userId: string; roleId: string; scopeType: "global" | "department" | "cost_center"; scopeId: string | null },
): Promise<{ error?: string; id?: string }> {
  const { userId, roleId, scopeType, scopeId } = params;
  if (!userId || !roleId) return { error: "User and role are required." };

  const duplicate = await tx
    .select({ id: userRoles.id })
    .from(userRoles)
    .where(
      and(
        eq(userRoles.tenantId, tenantId),
        eq(userRoles.userId, userId),
        eq(userRoles.roleId, roleId),
        eq(userRoles.scopeType, scopeType),
        scopeId === null ? isNull(userRoles.scopeId) : eq(userRoles.scopeId, scopeId),
      ),
    );
  if (duplicate.length > 0) {
    return { error: "That role and scope is already assigned to this user." };
  }

  const [created] = await tx.insert(userRoles).values({ tenantId, userId, roleId, scopeType, scopeId }).returning();
  await logAction(tx, {
    tenantId,
    actorUserId,
    action: "user_role.assigned",
    entityType: "user_role",
    entityId: created.id,
    metadata: { userId, roleId, scopeType, scopeId },
  });
  return { id: created.id };
}

export async function setUserStatus(
  tx: typeof db,
  tenantId: string,
  actorUserId: string,
  userId: string,
  status: "active" | "disabled",
) {
  await tx.update(users).set({ status, updatedAt: new Date() }).where(eq(users.id, userId));
  await logAction(tx, {
    tenantId,
    actorUserId,
    action: status === "disabled" ? "user.disabled" : "user.reenabled",
    entityType: "user",
    entityId: userId,
    metadata: {},
  });
}
