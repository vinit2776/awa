"use server";

import { eq } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { pushSubscriptions } from "@/db/schema";

export async function subscribeToPush(subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) {
  const { user, tenant } = await getCurrentUserAndTenant();

  await withTenant(tenant.id, (tx) =>
    tx
      .insert(pushSubscriptions)
      .values({ tenantId: tenant.id, userId: user.id, endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth })
      .onConflictDoNothing(),
  );
}

export async function unsubscribeFromPush(endpoint: string) {
  const { tenant } = await getCurrentUserAndTenant();
  await withTenant(tenant.id, (tx) => tx.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)));
}
