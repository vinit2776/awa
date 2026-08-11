import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "../adminClient";
import { db } from "../client";
import { withTenant } from "../withTenant";
import {
  tenants,
  users,
  departments,
  catalogItems,
  vendors,
  purchaseRequisitions,
  purchaseOrders,
  invoices,
} from "../schema";

/**
 * Proves tenant isolation holds through the actual query path every
 * server action uses (app_runtime + withTenant), not just that RLS
 * policies exist. Covers one table from each functional area added
 * across Sprints 1-9 — foundation, catalog, requisition, sourcing,
 * invoicing — as a representative sample of the generic tenant_id-based
 * RLS policy applied to every table in migration 0001, not a per-table
 * special case that could drift out of sync with new tables.
 */

let tenantA: typeof tenants.$inferSelect;
let tenantB: typeof tenants.$inferSelect;

beforeAll(async () => {
  [tenantA] = await adminDb.insert(tenants).values({ name: "RLS Test A", slug: "rls-test-a" }).returning();
  [tenantB] = await adminDb.insert(tenants).values({ name: "RLS Test B", slug: "rls-test-b" }).returning();

  await withTenant(tenantA.id, async (tx) => {
    const [dept] = await tx.insert(departments).values({ tenantId: tenantA.id, name: "Dept A" }).returning();
    const [user] = await tx.insert(users).values({ tenantId: tenantA.id, email: "a@example.com", fullName: "User A", status: "active" }).returning();
    await tx.insert(catalogItems).values({ tenantId: tenantA.id, name: "Item A" });
    const [vendor] = await tx.insert(vendors).values({ tenantId: tenantA.id, name: "Vendor A" }).returning();
    const [req] = await tx
      .insert(purchaseRequisitions)
      .values({ tenantId: tenantA.id, requestorId: user.id, departmentId: dept.id, status: "approved", totalEstimatedValue: "100" })
      .returning();
    const [po] = await tx
      .insert(purchaseOrders)
      .values({ tenantId: tenantA.id, requisitionId: req.id, vendorId: vendor.id, poNumber: "PO-RLS-A", status: "issued", totalAmount: "100" })
      .returning();
    await tx.insert(invoices).values({ tenantId: tenantA.id, vendorId: vendor.id, poId: po.id, invoiceNumber: "INV-RLS-A", invoiceDate: "2026-01-01", totalAmount: "100" });
  });

  await withTenant(tenantB.id, async (tx) => {
    const [dept] = await tx.insert(departments).values({ tenantId: tenantB.id, name: "Dept B" }).returning();
    const [user] = await tx.insert(users).values({ tenantId: tenantB.id, email: "b@example.com", fullName: "User B", status: "active" }).returning();
    await tx.insert(catalogItems).values({ tenantId: tenantB.id, name: "Item B" });
    const [vendor] = await tx.insert(vendors).values({ tenantId: tenantB.id, name: "Vendor B" }).returning();
    const [req] = await tx
      .insert(purchaseRequisitions)
      .values({ tenantId: tenantB.id, requestorId: user.id, departmentId: dept.id, status: "approved", totalEstimatedValue: "200" })
      .returning();
    const [po] = await tx
      .insert(purchaseOrders)
      .values({ tenantId: tenantB.id, requisitionId: req.id, vendorId: vendor.id, poNumber: "PO-RLS-B", status: "issued", totalAmount: "200" })
      .returning();
    await tx.insert(invoices).values({ tenantId: tenantB.id, vendorId: vendor.id, poId: po.id, invoiceNumber: "INV-RLS-B", invoiceDate: "2026-01-01", totalAmount: "200" });
  });
});

afterAll(async () => {
  // adminDb (owner role, bypasses RLS) so cleanup can see and delete
  // both tenants' rows in one pass regardless of which one is "current".
  const cleanupTables = [invoices, purchaseOrders, purchaseRequisitions, vendors, catalogItems, users, departments];
  for (const table of cleanupTables) {
    await adminDb.delete(table).where(sql`tenant_id in (${tenantA.id}, ${tenantB.id})`);
  }
  await adminDb.delete(tenants).where(sql`id in (${tenantA.id}, ${tenantB.id})`);
});

describe("RLS isolation", () => {
  it("an unscoped app_runtime query (no withTenant) sees nothing, even though rows exist", async () => {
    const rows = await db.select().from(departments);
    const testRows = rows.filter((r) => r.tenantId === tenantA.id || r.tenantId === tenantB.id);
    expect(testRows).toHaveLength(0);
  });

  it.each([
    { name: "departments", table: departments },
    { name: "users", table: users },
    { name: "catalog_items", table: catalogItems },
    { name: "vendors", table: vendors },
    { name: "purchase_requisitions", table: purchaseRequisitions },
    { name: "purchase_orders", table: purchaseOrders },
    { name: "invoices", table: invoices },
  ])("withTenant(A) querying $name sees only A's rows, never B's", async ({ table }) => {
    const rows = await withTenant(tenantA.id, (tx) => tx.select().from(table as typeof departments));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => (r as { tenantId: string }).tenantId === tenantA.id)).toBe(true);
  });

  it("withTenant(B) querying a specific row that exists only in A returns nothing, even by exact id", async () => {
    const [rowInA] = await withTenant(tenantA.id, (tx) => tx.select().from(users).where(eq(users.email, "a@example.com")));
    expect(rowInA).toBeDefined();

    const seenFromB = await withTenant(tenantB.id, (tx) => tx.select().from(users).where(eq(users.id, rowInA.id)));
    expect(seenFromB).toHaveLength(0);
  });

  it("withTenant(A) cannot write a row under B's tenant_id label (RLS with-check blocks it)", async () => {
    await expect(
      withTenant(tenantA.id, (tx) => tx.insert(departments).values({ tenantId: tenantB.id, name: "Smuggled" })),
    ).rejects.toThrow();
  });
});
