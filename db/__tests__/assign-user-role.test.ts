import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "../adminClient";
import { withTenant } from "../withTenant";
import { assignUserRole } from "../userInvite";
import { tenants, users, roles, userRoles, departments, auditLog } from "../schema";

/**
 * Found live (admin console dogfooding, S: go-live hardening): assigning
 * a role had no duplicate guard, so a repeat submission — a double
 * click, or two admins racing on the same user — silently created
 * identical user_roles rows. Global-scoped duplicates are the case that
 * actually happened: scope_id is NULL for global scope, and Postgres
 * treats every NULL as distinct, so a plain DB unique constraint
 * wouldn't have caught it either — assignUserRole checks explicitly.
 */

let tenant: typeof tenants.$inferSelect;
let user: typeof users.$inferSelect;
let role: typeof roles.$inferSelect;
let dept: typeof departments.$inferSelect;

beforeAll(async () => {
  [tenant] = await adminDb.insert(tenants).values({ name: "Role Dup Co", slug: "role-dup-co" }).returning();
  [user] = await adminDb.insert(users).values({ tenantId: tenant.id, email: "role-dup@example.com", fullName: "Rae Dupe", status: "active" }).returning();
  [role] = await adminDb.insert(roles).values({ tenantId: tenant.id, key: "dup-role", displayName: "Dup Role" }).returning();
  [dept] = await adminDb.insert(departments).values({ tenantId: tenant.id, name: "Dup Dept" }).returning();
});

afterAll(async () => {
  const tables = [auditLog, userRoles, departments, roles, users];
  for (const table of tables) {
    await adminDb.delete(table).where(sql`tenant_id = ${tenant.id}`);
  }
  await adminDb.delete(tenants).where(eq(tenants.id, tenant.id));
});

describe("assignUserRole", () => {
  it("assigns a global-scoped role", async () => {
    const result = await withTenant(tenant.id, (tx) =>
      assignUserRole(tx, tenant.id, user.id, { userId: user.id, roleId: role.id, scopeType: "global", scopeId: null }),
    );
    expect(result.error).toBeUndefined();
    expect(result.id).toBeDefined();
  });

  it("refuses a repeat submission of the same global-scoped role", async () => {
    const result = await withTenant(tenant.id, (tx) =>
      assignUserRole(tx, tenant.id, user.id, { userId: user.id, roleId: role.id, scopeType: "global", scopeId: null }),
    );
    expect(result.error).toBeDefined();

    const rows = await withTenant(tenant.id, (tx) => tx.select().from(userRoles).where(eq(userRoles.userId, user.id)));
    expect(rows).toHaveLength(1);
  });

  it("still allows the same role at a different scope", async () => {
    const result = await withTenant(tenant.id, (tx) =>
      assignUserRole(tx, tenant.id, user.id, { userId: user.id, roleId: role.id, scopeType: "department", scopeId: dept.id }),
    );
    expect(result.error).toBeUndefined();

    const rows = await withTenant(tenant.id, (tx) => tx.select().from(userRoles).where(eq(userRoles.userId, user.id)));
    expect(rows).toHaveLength(2);
  });
});
