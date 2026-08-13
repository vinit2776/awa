import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "./client";
import { platformAdmins } from "./schema";
import { PLATFORM_SESSION_COOKIE } from "./userSession";
import { verifyPlatformAdminSessionToken } from "./userAuth";

// Thrown by getCurrentPlatformAdmin when there's no valid platform_session
// cookie — distinct from an unexpected failure so callers (the /platform
// page) can render a sign-in form instead of a 500.
export class PlatformAdminAccessError extends Error {
  constructor() {
    super("Not signed in as a platform admin.");
    this.name = "PlatformAdminAccessError";
  }
}

/**
 * platform_admins carries no tenant_id, so it's outside the RLS loop
 * entirely (see 0001_init.sql) — reading it through the regular
 * app_runtime connection is fine, no elevated access needed.
 */
export async function getCurrentPlatformAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get(PLATFORM_SESSION_COOKIE)?.value;
  const adminId = token ? verifyPlatformAdminSessionToken(token) : null;
  if (!adminId) throw new PlatformAdminAccessError();

  const [admin] = await db.select().from(platformAdmins).where(eq(platformAdmins.id, adminId)).limit(1);
  if (!admin) throw new PlatformAdminAccessError();

  return admin;
}
