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
  supportTickets,
  supportTicketMessages,
  supportTicketEvents,
  transactionClarifications,
  transactionClarificationMessages,
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
  const suffix = crypto.randomUUID().slice(0, 8);
  [tenantA] = await adminDb.insert(tenants).values({ name: "RLS Test A", slug: `rls-test-a-${suffix}` }).returning();
  [tenantB] = await adminDb.insert(tenants).values({ name: "RLS Test B", slug: `rls-test-b-${suffix}` }).returning();

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

    // Support desk + clarifications (0011, 0012). Both carry tenant_id, but
    // their RLS policies were written by hand in those migrations — the
    // generic do-block in 0001 only ran once and does not cover later tables.
    // A new tenant-scoped table missing from this test is an untested
    // isolation claim, which AGENTS.md treats as a launch blocker.
    const [ticketA] = await tx
      .insert(supportTickets)
      .values({ tenantId: tenantA.id, type: "bug", subject: "Ticket A", description: "A", reportedByUserId: user.id })
      .returning();
    await tx.insert(supportTicketMessages).values({ tenantId: tenantA.id, ticketId: ticketA.id, body: "msg A", authorUserId: user.id });
    await tx.insert(supportTicketEvents).values({ tenantId: tenantA.id, ticketId: ticketA.id, event: "created", actorKind: "customer", actorUserId: user.id });
    const [clarA] = await tx
      .insert(transactionClarifications)
      .values({ tenantId: tenantA.id, entityType: "requisition", entityId: req.id, raisedByUserId: user.id, question: "Q A" })
      .returning();
    await tx.insert(transactionClarificationMessages).values({ tenantId: tenantA.id, clarificationId: clarA.id, authorUserId: user.id, body: "reply A" });
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

    const [ticketB] = await tx
      .insert(supportTickets)
      .values({ tenantId: tenantB.id, type: "bug", subject: "Ticket B", description: "B", reportedByUserId: user.id })
      .returning();
    await tx.insert(supportTicketMessages).values({ tenantId: tenantB.id, ticketId: ticketB.id, body: "msg B", authorUserId: user.id });
    await tx.insert(supportTicketEvents).values({ tenantId: tenantB.id, ticketId: ticketB.id, event: "created", actorKind: "customer", actorUserId: user.id });
    const [clarB] = await tx
      .insert(transactionClarifications)
      .values({ tenantId: tenantB.id, entityType: "requisition", entityId: req.id, raisedByUserId: user.id, question: "Q B" })
      .returning();
    await tx.insert(transactionClarificationMessages).values({ tenantId: tenantB.id, clarificationId: clarB.id, authorUserId: user.id, body: "reply B" });
  });
});

afterAll(async () => {
  // adminDb (owner role, bypasses RLS) so cleanup can see and delete
  // both tenants' rows in one pass regardless of which one is "current".
  // Child rows before parents. support_ticket_events has update/delete revoked
  // from app_runtime, but adminDb is the owner role, so cleanup can still
  // remove it — the revoke constrains the application, not the migration role.
  const cleanupTables = [
    transactionClarificationMessages,
    transactionClarifications,
    supportTicketEvents,
    supportTicketMessages,
    supportTickets,
    invoices,
    purchaseOrders,
    purchaseRequisitions,
    vendors,
    catalogItems,
    users,
    departments,
  ];
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
    { name: "support_tickets", table: supportTickets },
    { name: "support_ticket_messages", table: supportTicketMessages },
    { name: "support_ticket_events", table: supportTicketEvents },
    { name: "transaction_clarifications", table: transactionClarifications },
    { name: "transaction_clarification_messages", table: transactionClarificationMessages },
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
