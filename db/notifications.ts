import { eq } from "drizzle-orm";
import type { db } from "./client";
import { sendPushToUser } from "./push";
import { logEmailResult, sendEmail } from "./email";
import { users } from "./schema";

export type NotificationType =
  | "requisition_submitted"
  | "approval_needed"
  | "requisition_approved"
  | "requisition_rejected"
  | "vendor_po_issued"
  | "approval_escalated"
  // Support desk (customer ↔ AWA support). Only ever sent to the customer
  // side: a platform admin has no users row and therefore no push
  // subscription to look up, so support-side alerting stays in the console.
  | "support_ticket_replied"
  | "support_ticket_resolved"
  // Transaction clarifications (colleague ↔ colleague). Both parties are
  // tenant users, so these work end-to-end today — unlike the support
  // notifications above, they don't wait on an email provider to be useful.
  | "clarification_raised"
  | "clarification_answered"
  | "clarification_resolved";

/**
 * Transactional email now goes through db/email.ts (Resend). When that isn't
 * configured it logs exactly as this stub always did, so nothing here depends
 * on an account existing — the triggering logic stays testable either way.
 *
 * Email is sent before push, and neither can fail the caller: sendEmail()
 * never throws, and the push send is caught below. This matters because
 * deliver() runs inside the caller's withTenant transaction, so an exception
 * escaping here would roll back the approval or ticket that prompted the
 * notification. A notification failing must never undo the thing it was
 * notifying about.
 *
 * Web Push (S14) is wired here too, additively — real delivery, not a
 * stub, whenever VAPID is configured and the target user (vendors have
 * none) has at least one subscribed device.
 */
async function deliver(params: { type: NotificationType; toEmail: string; subject: string; body: string; userId?: string; tx?: typeof db }) {
  const result = await sendEmail({ to: params.toEmail, subject: params.subject, text: params.body });
  logEmailResult(`notification:${params.type}`, params.toEmail, params.subject, params.body, result);

  if (params.userId && params.tx) {
    try {
      await sendPushToUser(params.tx, params.userId, { title: params.subject, body: params.body });
    } catch (error) {
      // Same reasoning as the email path: a dead push subscription must not
      // roll back the caller's transaction.
      console.error(`[notification:${params.type}] push failed for user=${params.userId} —`, error);
    }
  }
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
  await deliver({ type, toEmail: user.email, subject, body, userId, tx });
}

// Vendor contacts (vendor_users) have no auth of their own — no user_id
// to look up, just an email captured at data entry — so this takes the
// address directly rather than resolving it from a users row, and never
// gets push (there's no subscription to look up without a user_id).
export async function notifyVendor(toEmail: string | null, subject: string, body: string) {
  if (!toEmail) return;
  await deliver({ type: "vendor_po_issued", toEmail, subject, body });
}
