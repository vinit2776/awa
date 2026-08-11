import { eq } from "drizzle-orm";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { adminDb } from "./adminClient";
import { isPlatformAdminEmail } from "./platformAdmins";
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
    // A platform admin has no tenant/users row by design (they're a
    // different kind of principal, see db/platformSession.ts) — every
    // dashboard page calls this, and the callback's returnPathname is
    // always "/dashboard" regardless of who signed in, so this is the
    // one place that can actually redirect them to where they belong
    // instead of surfacing the generic "not linked" error meant for a
    // genuinely mis-provisioned tenant user.
    if (await isPlatformAdminEmail(workosUser.email)) {
      redirect("/platform");
    }

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
