import { eq } from "drizzle-orm";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { adminDb } from "./adminClient";
import { tenants, users } from "./schema";

/**
 * Resolves the signed-in WorkOS user to our internal user/tenant rows.
 * Redirects to sign-in if there's no session (ensureSignedIn: true).
 * Uses adminDb for the same reason db/tenant.ts does — this lookup is how
 * we find out which tenant applies, so it has to run before that scope
 * exists to enforce.
 */
export async function getCurrentUserAndTenant() {
  const { user: workosUser } = await withAuth({ ensureSignedIn: true });

  const [row] = await adminDb
    .select({ user: users, tenant: tenants })
    .from(users)
    .innerJoin(tenants, eq(users.tenantId, tenants.id))
    .where(eq(users.workosUserId, workosUser.id))
    .limit(1);

  if (!row) {
    throw new Error(
      `Signed in as ${workosUser.email} but not linked to an internal user — ` +
        `the callback route should have run linkUserOnSignIn first.`,
    );
  }

  // Checked on every request, not just at sign-in — a disabled user's
  // existing WorkOS session cookie stays valid until it naturally
  // expires, so "disabled" only actually revokes access if this check
  // runs here too, not only in linkUserOnSignIn's one-time JIT path.
  if (row.user.status === "disabled") {
    throw new Error(`This account (${row.user.email}) has been disabled. Contact your tenant administrator.`);
  }

  return row;
}
