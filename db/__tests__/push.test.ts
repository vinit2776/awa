import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { adminDb } from "../adminClient";
import { withTenant } from "../withTenant";
import { tenants, users, pushSubscriptions } from "../schema";

const sendNotification = vi.fn();
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: (...args: unknown[]) => sendNotification(...args),
  },
}));

let tenant: typeof tenants.$inferSelect;
let user: typeof users.$inferSelect;

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  [tenant] = await adminDb.insert(tenants).values({ name: "Push Test Co", slug: `push-test-co-${suffix}` }).returning();
  [user] = await adminDb.insert(users).values({ tenantId: tenant.id, email: "push@example.com", fullName: "Push User", status: "active" }).returning();
});

afterEach(async () => {
  sendNotification.mockReset();
  // Each test needs a clean subscription slate — otherwise an earlier
  // test's leftover subscription for the same user would make a later
  // test's "was this sent to" assertion count calls that have nothing
  // to do with what that test is actually checking.
  await adminDb.delete(pushSubscriptions).where(eq(pushSubscriptions.tenantId, tenant.id));
});

afterAll(async () => {
  await adminDb.delete(pushSubscriptions).where(eq(pushSubscriptions.tenantId, tenant.id));
  await adminDb.delete(users).where(eq(users.tenantId, tenant.id));
  await adminDb.delete(tenants).where(eq(tenants.id, tenant.id));
});

describe("sendPushToUser", () => {
  it("sends to every subscription a user has", async () => {
    sendNotification.mockResolvedValue({});
    const { sendPushToUser } = await import("../push");

    await withTenant(tenant.id, async (tx) => {
      await tx.insert(pushSubscriptions).values({ tenantId: tenant.id, userId: user.id, endpoint: "https://push.example.com/a", p256dh: "key-a", auth: "auth-a" });
      await tx.insert(pushSubscriptions).values({ tenantId: tenant.id, userId: user.id, endpoint: "https://push.example.com/b", p256dh: "key-b", auth: "auth-b" });

      await sendPushToUser(tx, user.id, { title: "Test", body: "Body" });
    });

    expect(sendNotification).toHaveBeenCalledTimes(2);
  });

  it("deletes a subscription that the push service reports as gone (410)", async () => {
    sendNotification.mockRejectedValueOnce(Object.assign(new Error("gone"), { statusCode: 410 }));
    const { sendPushToUser } = await import("../push");

    const [sub] = await withTenant(tenant.id, (tx) =>
      tx.insert(pushSubscriptions).values({ tenantId: tenant.id, userId: user.id, endpoint: "https://push.example.com/dead", p256dh: "key", auth: "auth" }).returning(),
    );

    await withTenant(tenant.id, (tx) => sendPushToUser(tx, user.id, { title: "Test", body: "Body" }));

    const remaining = await withTenant(tenant.id, (tx) => tx.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id)));
    expect(remaining).toHaveLength(0);
  });

  it("leaves a subscription alone on a non-410/404 failure (transient error, might still be good)", async () => {
    sendNotification.mockRejectedValueOnce(Object.assign(new Error("server error"), { statusCode: 500 }));
    const { sendPushToUser } = await import("../push");

    const [sub] = await withTenant(tenant.id, (tx) =>
      tx.insert(pushSubscriptions).values({ tenantId: tenant.id, userId: user.id, endpoint: "https://push.example.com/transient", p256dh: "key", auth: "auth" }).returning(),
    );

    await withTenant(tenant.id, (tx) => sendPushToUser(tx, user.id, { title: "Test", body: "Body" }));

    const remaining = await withTenant(tenant.id, (tx) => tx.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id)));
    expect(remaining).toHaveLength(1);
  });

  it("never sends to another user's subscription", async () => {
    sendNotification.mockResolvedValue({});
    const { sendPushToUser } = await import("../push");

    const [otherUser] = await adminDb.insert(users).values({ tenantId: tenant.id, email: "other@example.com", fullName: "Other User", status: "active" }).returning();
    await withTenant(tenant.id, (tx) => tx.insert(pushSubscriptions).values({ tenantId: tenant.id, userId: otherUser.id, endpoint: "https://push.example.com/other", p256dh: "key", auth: "auth" }));

    await withTenant(tenant.id, (tx) => sendPushToUser(tx, user.id, { title: "Test", body: "Body" }));

    expect(sendNotification).not.toHaveBeenCalled();
    await adminDb.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, otherUser.id));
    await adminDb.delete(users).where(eq(users.id, otherUser.id));
  });
});
