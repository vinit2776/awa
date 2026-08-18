import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "../adminClient";
import { linkUserOnSignIn, TenantLinkError } from "../tenant";
import { tenants, users } from "../schema";

// linkUserOnSignIn() resolves workos_user_id with no tenant scope (that lookup
// is what establishes the tenant), and the column is globally unique — so a
// fixed id on the shared dev database either collides outright with a
// concurrent run or, worse, hits the already-linked fast path against the
// other run's user and skips the check under test.
const suffix = crypto.randomUUID().slice(0, 8);
const workosUser = (name: string) => `workos_user_${name}_${suffix}`;

let unrestrictedTenant: typeof tenants.$inferSelect;
let restrictedTenant: typeof tenants.$inferSelect;

beforeAll(async () => {
  [unrestrictedTenant] = await adminDb
    .insert(tenants)
    .values({ name: "Unrestricted Co", slug: `unrestricted-co-${suffix}`, workosOrganizationId: `org_unrestricted_test_${suffix}` })
    .returning();
  [restrictedTenant] = await adminDb
    .insert(tenants)
    .values({ name: "Restricted Co", slug: `restricted-co-${suffix}`, workosOrganizationId: `org_restricted_test_${suffix}`, allowedEmailDomains: ["acme.com"] })
    .returning();
});

afterAll(async () => {
  for (const tenant of [unrestrictedTenant, restrictedTenant]) {
    await adminDb.delete(users).where(eq(users.tenantId, tenant.id));
  }
  await adminDb.delete(tenants).where(sql`id in (${unrestrictedTenant.id}, ${restrictedTenant.id})`);
});

describe("domain restriction at JIT sign-in linking", () => {
  it("an unrestricted tenant (empty allowed_email_domains) accepts any pre-provisioned user regardless of email domain", async () => {
    await adminDb.insert(users).values({ tenantId: unrestrictedTenant.id, email: `person-${suffix}@anydomain.example`, fullName: "Any Person", status: "invited" });

    const linked = await linkUserOnSignIn({
      workosUserId: workosUser("unrestricted_1"),
      workosOrganizationId: unrestrictedTenant.workosOrganizationId!,
      email: `person-${suffix}@anydomain.example`,
    });

    expect(linked.status).toBe("active");
  });

  it("a restricted tenant accepts a pre-provisioned user whose email is on an allowed domain", async () => {
    await adminDb.insert(users).values({ tenantId: restrictedTenant.id, email: `person-${suffix}@acme.com`, fullName: "Acme Person", status: "invited" });

    const linked = await linkUserOnSignIn({
      workosUserId: workosUser("restricted_ok"),
      workosOrganizationId: restrictedTenant.workosOrganizationId!,
      email: `person-${suffix}@acme.com`,
    });

    expect(linked.status).toBe("active");
  });

  it("a restricted tenant rejects a pre-provisioned user whose email is on a domain not on the allow-list — even though the users row genuinely exists", async () => {
    // Pre-provisioned deliberately, to prove the domain check is a real
    // second layer of defense, not just a stand-in for "no such user".
    await adminDb.insert(users).values({ tenantId: restrictedTenant.id, email: `person-${suffix}@gmail.com`, fullName: "Personal Email Person", status: "invited" });

    await expect(
      linkUserOnSignIn({
        workosUserId: workosUser("restricted_blocked"),
        workosOrganizationId: restrictedTenant.workosOrganizationId!,
        email: `person-${suffix}@gmail.com`,
      }),
    ).rejects.toThrow(TenantLinkError);

    const [stillPending] = await adminDb
      .select()
      .from(users)
      .where(and(eq(users.tenantId, restrictedTenant.id), eq(users.email, `person-${suffix}@gmail.com`)));
    expect(stillPending.status).toBe("invited");
    expect(stillPending.workosUserId).toBeNull();
  });
});
