import { eq } from "drizzle-orm";
import { db } from "./client";
import { platformAdmins } from "./schema";

/**
 * Deliberately separate from db/platformSession.ts, not merged in
 * alongside getCurrentPlatformAdmin — that file imports withAuth from
 * @workos-inc/authkit-nextjs, which pulls in next/cache at module load
 * time and can't resolve outside Next's own runtime (breaks any vitest
 * file that imports it, even indirectly). This function has no auth
 * dependency at all — it's a plain query two other call sites need
 * (src/app/callback/route.ts, db/session.ts) without wanting withAuth
 * dragged in with it.
 */
export async function isPlatformAdminEmail(email: string): Promise<boolean> {
  const [admin] = await db.select().from(platformAdmins).where(eq(platformAdmins.email, email)).limit(1);
  return !!admin;
}
