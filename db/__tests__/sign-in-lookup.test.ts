import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "../adminClient";
import { withTenant } from "../withTenant";
import { resolveSignInTargets } from "../signInLookup";
import { platformAdmins, tenants, users } from "../schema";

let tenantA: typeof tenants.$inferSelect;
let tenantB: typeof tenants.$inferSelect;
let admin: typeof platformAdmins.$inferSelect;

beforeAll(async () => {
  [tenantA] = await adminDb
    .insert(tenants)
    .values({ name: "Sign-in Lookup Co A", slug: "sign-in-lookup-co-a", workosOrganizationId: "org_lookup_a" })
    .returning();
  [tenantB] = await adminDb
    .insert(tenants)
    .values({ name: "Sign-in Lookup Co B", slug: "sign-in-lookup-co-b", workosOrganizationId: "org_lookup_b" })
    .returning();
  [admin] = await adminDb
    .insert(platformAdmins)
    .values({ email: "sil-admin@example.com", fullName: "Sil Admin", role: "support" })
    .returning();
});

afterAll(async () => {
  for (const tenant of [tenantA, tenantB]) {
    await adminDb.delete(users).where(sql`tenant_id = ${tenant.id}`);
  }
  await adminDb.delete(tenants).where(eq(tenants.id, tenantA.id));
  await adminDb.delete(tenants).where(eq(tenants.id, tenantB.id));
  await adminDb.delete(platformAdmins).where(eq(platformAdmins.id, admin.id));
});

describe("resolveSignInTargets", () => {
  it("returns no tenants and isPlatformAdmin=false for an unrecognized email", async () => {
    const result = await resolveSignInTargets("nobody@example.com");
    expect(result.isPlatformAdmin).toBe(false);
    expect(result.tenants).toHaveLength(0);
  });

  it("resolves to the single tenant a pre-provisioned email belongs to", async () => {
    await withTenant(tenantA.id, (tx) =>
      tx.insert(users).values({ tenantId: tenantA.id, email: "single@example.com", fullName: "Single Tenant" }),
    );
    const result = await resolveSignInTargets("single@example.com");
    expect(result.isPlatformAdmin).toBe(false);
    expect(result.tenants).toHaveLength(1);
    expect(result.tenants[0].organizationId).toBe("org_lookup_a");
  });

  it("resolves every tenant when the same email is pre-provisioned under more than one", async () => {
    await withTenant(tenantA.id, (tx) =>
      tx.insert(users).values({ tenantId: tenantA.id, email: "shared@example.com", fullName: "Shared" }),
    );
    await withTenant(tenantB.id, (tx) =>
      tx.insert(users).values({ tenantId: tenantB.id, email: "shared@example.com", fullName: "Shared" }),
    );
    const result = await resolveSignInTargets("shared@example.com");
    expect(result.tenants).toHaveLength(2);
    expect(result.tenants.map((t) => t.organizationId).sort()).toEqual(["org_lookup_a", "org_lookup_b"]);
  });

  it("flags isPlatformAdmin for a platform admin's email, regardless of case", async () => {
    const result = await resolveSignInTargets("SIL-Admin@Example.com");
    expect(result.isPlatformAdmin).toBe(true);
    expect(result.tenants).toHaveLength(0);
  });
});
