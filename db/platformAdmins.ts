import { eq } from "drizzle-orm";
import { db } from "./client";
import { platformAdmins } from "./schema";

/**
 * A plain query with no session/cookie dependency — kept separate from
 * db/platformSession.ts so callers that just need "is this email a
 * platform admin" don't have to pull in cookie/session handling for it.
 */
export async function isPlatformAdminEmail(email: string): Promise<boolean> {
  const [admin] = await db.select().from(platformAdmins).where(eq(platformAdmins.email, email)).limit(1);
  return !!admin;
}
