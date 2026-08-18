import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "../adminClient";
import { withTenant } from "../withTenant";
import { inviteUser, setUserStatus } from "../userInvite";
import { linkUserOnSignIn, TenantLinkError } from "../tenant";
import { tenants, users, auditLog } from "../schema";

// Globally unique, and resolved with no tenant scope by linkUserOnSignIn() —
// see the note in db/__tests__/domain-restriction.test.ts. A fixed id lets a
// concurrent run's still-active user satisfy the already-linked fast path, so
// the disabled-user rejection below never fires.
const suffix = crypto.randomUUID().slice(0, 8);
const workosUser = (name: string) => `workos_${name}_${suffix}`;

let tenant: typeof tenants.$inferSelect;
let restrictedTenant: typeof tenants.$inferSelect;
let admin: typeof users.$inferSelect;

beforeAll(async () => {
  [tenant] = await adminDb.insert(tenants).values({ name: "Invite Test Co", slug: `invite-test-co-${suffix}`, workosOrganizationId: `org_invite_test_${suffix}` }).returning();
  [restrictedTenant] = await adminDb
    .insert(tenants)
    .values({ name: "Invite Restricted Co", slug: `invite-restricted-co-${suffix}`, workosOrganizationId: `org_invite_restricted_${suffix}`, allowedEmailDomains: ["acme.com"] })
    .returning();
  [admin] = await adminDb.insert(users).values({ tenantId: tenant.id, email: "admin@example.com", fullName: "Admin Person", status: "active" }).returning();
});

afterAll(async () => {
  // audit_log rows must all go first, across *both* tenants, before any
  // users are deleted — admin acts as the actor on invites scoped to
  // restrictedTenant too, so its audit_log rows (tenantId =
  // restrictedTenant.id) still reference admin.id (a user under
  // tenant.id) via actor_user_id. Deleting tenant-by-tenant in one pass
  // hits that FK the same way the aborted-transaction bug did above —
  // a cross-cutting reference the per-tenant loop doesn't account for.
  await adminDb.delete(auditLog).where(eq(auditLog.tenantId, tenant.id));
  await adminDb.delete(auditLog).where(eq(auditLog.tenantId, restrictedTenant.id));
  await adminDb.delete(users).where(eq(users.tenantId, tenant.id));
  await adminDb.delete(users).where(eq(users.tenantId, restrictedTenant.id));
  await adminDb.delete(tenants).where(eq(tenants.id, tenant.id));
  await adminDb.delete(tenants).where(eq(tenants.id, restrictedTenant.id));
});

describe("inviteUser", () => {
  it("creates a user row with status 'invited'", async () => {
    const result = await withTenant(tenant.id, (tx) => inviteUser(tx, tenant.id, admin.id, { email: "New.Person@Example.com", fullName: "New Person" }));
    expect(result.error).toBeUndefined();
    expect(result.userId).toBeDefined();

    const [created] = await withTenant(tenant.id, (tx) => tx.select().from(users).where(eq(users.id, result.userId!)));
    expect(created.status).toBe("invited");
    // Lowercased — must match exactly what a WorkOS sign-in's email will
    // be compared against later, case-sensitivity mismatches would
    // silently strand an invite forever.
    expect(created.email).toBe("new.person@example.com");
  });

  it("rejects a duplicate invite for the same tenant + email", async () => {
    await withTenant(tenant.id, (tx) => inviteUser(tx, tenant.id, admin.id, { email: "dup@example.com", fullName: "Dup Person" }));
    const second = await withTenant(tenant.id, (tx) => inviteUser(tx, tenant.id, admin.id, { email: "dup@example.com", fullName: "Dup Person Again" }));
    expect(second.error).toBeDefined();
  });

  it("rejects an invite for a domain not on the tenant's allow-list, at invite time — not only at sign-in time", async () => {
    const result = await withTenant(restrictedTenant.id, (tx) => inviteUser(tx, restrictedTenant.id, admin.id, { email: "person@gmail.com", fullName: "Wrong Domain" }));
    expect(result.error).toContain("allowed domain");

    const rows = await withTenant(restrictedTenant.id, (tx) => tx.select().from(users).where(eq(users.email, "person@gmail.com")));
    expect(rows).toHaveLength(0);
  });

  it("accepts an invite for a domain that is on the allow-list", async () => {
    const result = await withTenant(restrictedTenant.id, (tx) => inviteUser(tx, restrictedTenant.id, admin.id, { email: "person@acme.com", fullName: "Right Domain" }));
    expect(result.error).toBeUndefined();
  });
});

describe("disabling a user actually blocks them", () => {
  it("setUserStatus('disabled') + a fresh JIT sign-in attempt is rejected, not silently allowed back in", async () => {
    // Simulates the full lifecycle: invited -> signs in once (linked) ->
    // later disabled -> tries to sign in again. This is the scenario
    // db/session.ts#getCurrentUserAndTenant can't be exercised for
    // directly here (it needs a live WorkOS session via withAuth()) —
    // but the fast path in linkUserOnSignIn that a disabled user would
    // hit on any subsequent sign-in attempt is fully testable, and is
    // the same status check session.ts applies on every request after.
    const invited = await withTenant(tenant.id, (tx) => inviteUser(tx, tenant.id, admin.id, { email: "disable-me@example.com", fullName: "Soon Disabled" }));
    const linked = await linkUserOnSignIn({ workosUserId: workosUser("disable_test"), workosOrganizationId: tenant.workosOrganizationId!, email: "disable-me@example.com" });
    expect(linked.status).toBe("active");

    await withTenant(tenant.id, (tx) => setUserStatus(tx, tenant.id, admin.id, invited.userId!, "disabled"));

    await expect(
      linkUserOnSignIn({ workosUserId: workosUser("disable_test"), workosOrganizationId: tenant.workosOrganizationId!, email: "disable-me@example.com" }),
    ).rejects.toThrow(TenantLinkError);
  });

  it("re-enabling restores access", async () => {
    const invited = await withTenant(tenant.id, (tx) => inviteUser(tx, tenant.id, admin.id, { email: "reenable-me@example.com", fullName: "Reenabled" }));
    await linkUserOnSignIn({ workosUserId: workosUser("reenable_test"), workosOrganizationId: tenant.workosOrganizationId!, email: "reenable-me@example.com" });
    await withTenant(tenant.id, (tx) => setUserStatus(tx, tenant.id, admin.id, invited.userId!, "disabled"));
    await withTenant(tenant.id, (tx) => setUserStatus(tx, tenant.id, admin.id, invited.userId!, "active"));

    const linked = await linkUserOnSignIn({ workosUserId: workosUser("reenable_test"), workosOrganizationId: tenant.workosOrganizationId!, email: "reenable-me@example.com" });
    expect(linked.status).toBe("active");
  });
});
