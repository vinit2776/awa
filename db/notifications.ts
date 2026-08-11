import { eq } from "drizzle-orm";
import type { db } from "./client";
import { users } from "./schema";

export type NotificationType =
  | "requisition_submitted"
  | "approval_needed"
  | "requisition_approved"
  | "requisition_rejected"
  | "vendor_po_issued";

/**
 * Transactional email has no provider account wired yet (Resend, SES,
 * Postmark — whichever gets picked needs a real account created, which
 * isn't something to do unprompted). Every call site in this file is
 * final; only `deliver`'s body needs to change once a provider exists —
 * swap the console.log for the provider's send call and everything
 * upstream keeps working unmodified. Until then this logs so the
 * triggering logic is fully wired and testable, just not actually
 * emailing anyone.
 */
async function deliver(params: { type: NotificationType; toEmail: string; subject: string; body: string }) {
  console.log(`[notification:${params.type}] to=${params.toEmail} subject="${params.subject}"\n${params.body}`);
}

export async function notifyUser(
  tx: typeof db,
  userId: string,
  type: NotificationType,
  subject: string,
  body: string,
) {
  const [user] = await tx.select({ email: users.email, fullName: users.fullName }).from(users).where(eq(users.id, userId));
  if (!user) return;
  await deliver({ type, toEmail: user.email, subject, body });
}

// Vendor contacts (vendor_users) have no auth of their own — no user_id
// to look up, just an email captured at data entry — so this takes the
// address directly rather than resolving it from a users row.
export async function notifyVendor(toEmail: string | null, subject: string, body: string) {
  if (!toEmail) return;
  await deliver({ type: "vendor_po_issued", toEmail, subject, body });
}
