import webpush from "web-push";
import { eq } from "drizzle-orm";
import type { db } from "./client";
import { pushSubscriptions } from "./schema";

function isConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

let configured = false;
function ensureConfigured() {
  if (configured || !isConfigured()) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  configured = true;
}

/**
 * Sends a push notification to every device a user has subscribed on.
 * A 404/410 from the push service means that subscription is dead (the
 * user uninstalled, cleared site data, or the browser expired it) — those
 * get cleaned up here rather than left to fail silently forever on every
 * future send. If VAPID isn't configured (e.g. a local dev environment
 * without the keys set), this quietly no-ops rather than throwing —
 * push is additive to the console-log notification transport from
 * Sprint 6, not a replacement that breaks everything else if unset.
 */
export async function sendPushToUser(tx: typeof db, userId: string, payload: { title: string; body: string; url?: string }) {
  if (!isConfigured()) return;
  ensureConfigured();

  const subscriptions = await tx.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
        );
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
        }
        // Other failures (network blips, transient 5xx) are left alone —
        // the subscription might still be good next time.
      }
    }),
  );
}
