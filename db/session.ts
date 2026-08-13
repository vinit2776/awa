import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adminDb } from "./adminClient";
import { tenants, users } from "./schema";
import { APP_SESSION_COOKIE } from "./userSession";
import { verifyUserSessionToken } from "./userAuth";

/**
 * Resolves the app_session cookie (db/userAuth.ts) to our internal
 * user/tenant rows. Redirects to sign-in if there's no valid session —
 * same shape db/vendorSession.ts#getCurrentVendorUser already uses for
 * vendor portal, applied here now that WorkOS is out of the loop
 * (temporary swap for testing, see AGENTS.md — workos_user_id and
 * db/tenant.ts are untouched, not deleted, so WorkOS can come back later
 * without another migration).
 */
export async function getCurrentUserAndTenant() {
  const cookieStore = await cookies();
  const token = cookieStore.get(APP_SESSION_COOKIE)?.value;
  const userId = token ? verifyUserSessionToken(token) : null;
  if (!userId) redirect("/");

  const [row] = await adminDb
    .select({ user: users, tenant: tenants })
    .from(users)
    .innerJoin(tenants, eq(users.tenantId, tenants.id))
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) redirect("/");

  // Checked on every request, not just at sign-in — a disabled user's
  // existing session cookie stays valid until it naturally expires, so
  // "disabled" only actually revokes access if this check runs here too.
  if (row.user.status === "disabled") {
    throw new Error(`This account (${row.user.email}) has been disabled. Contact your tenant administrator.`);
  }

  return row;
}
