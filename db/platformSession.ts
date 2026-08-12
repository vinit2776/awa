import { eq } from "drizzle-orm";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { db } from "./client";
import { platformAdmins } from "./schema";

// Thrown by getCurrentPlatformAdmin when the signed-in WorkOS user isn't in
// platform_admins — distinct from an unexpected failure so callers (the
// /platform page) can render an access-denied state instead of a 500.
export class PlatformAdminAccessError extends Error {
  constructor(public readonly email: string) {
    super(`${email} is not a platform admin.`);
    this.name = "PlatformAdminAccessError";
  }
}

/**
 * platform_admins carries no tenant_id, so it's outside the RLS loop
 * entirely (see 0001_init.sql) — reading it through the regular
 * app_runtime connection is fine, no elevated access needed. What makes
 * this a platform-level check is matching against this table at all,
 * not which DB role runs the query.
 */
export async function getCurrentPlatformAdmin() {
  const { user: workosUser } = await withAuth({ ensureSignedIn: true });

  const [admin] = await db.select().from(platformAdmins).where(eq(platformAdmins.email, workosUser.email)).limit(1);

  if (!admin) {
    throw new PlatformAdminAccessError(workosUser.email);
  }

  return admin;
}
