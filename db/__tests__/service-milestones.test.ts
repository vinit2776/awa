import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "../adminClient";
import { withTenant } from "../withTenant";
import { recordServiceAcceptance } from "../fulfillment";
import { matchInvoice } from "../invoiceMatch";
import { createMilestone, resolveMilestoneValue } from "../serviceMilestones";
import {
  tenants,
  users,
  vendors,
  purchaseRequisitions,
  purchaseOrders,
  purchaseOrderLines,
  serviceAcceptanceLines,
  serviceAcceptances,
  serviceMilestones,
  invoices,
  invoiceLines,
  invoiceLineMatches,
  auditLog,
} from "../schema";

let tenant: typeof tenants.$inferSelect;
let requestor: typeof users.$inferSelect;
let vendor: typeof vendors.$inferSelect;

async function makeServicePo(totalAmount: string) {
  return withTenant(tenant.id, async (tx) => {
    const [requisition] = await tx
      .insert(purchaseRequisitions)
      .values({ tenantId: tenant.id, requestorId: requestor.id, status: "converted_to_po", totalEstimatedValue: totalAmount })
      .returning();
    const [po] = await tx
      .insert(purchaseOrders)
      .values({ tenantId: tenant.id, requisitionId: requisition.id, vendorId: vendor.id, poNumber: `PO-MS-${Math.random().toString(36).slice(2, 8)}`, status: "issued", totalAmount })
      .returning();
    const [poLine] = await tx
      .insert(purchaseOrderLines)
      .values({ tenantId: tenant.id, poId: po.id, fulfillmentType: "service", serviceDescription: "Implementation", quantity: "1", uom: "each", unitPrice: totalAmount, lineTotal: totalAmount, status: "issued" })
      .returning();
    return { po, poLine };
  });
}

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  [tenant] = await adminDb.insert(tenants).values({ name: "Milestone Co", slug: `milestone-co-${suffix}` }).returning();
  [requestor] = await adminDb.insert(users).values({ tenantId: tenant.id, email: "ms-requestor@example.com", fullName: "Mo Requestor", status: "active" }).returning();
  [vendor] = await withTenant(tenant.id, (tx) => tx.insert(vendors).values({ tenantId: tenant.id, name: "Milestone Vendor" }).returning());
});

afterAll(async () => {
  const tables = [
    auditLog, invoiceLineMatches, invoiceLines, invoices,
    serviceAcceptanceLines, serviceAcceptances, serviceMilestones,
    purchaseOrderLines, purchaseOrders, purchaseRequisitions, vendors, users,
  ];
  for (const table of tables) {
    await adminDb.delete(table).where(sql`tenant_id = ${tenant.id}`);
  }
  await adminDb.delete(tenants).where(eq(tenants.id, tenant.id));
});

describe("createMilestone validation", () => {
  it("requires exactly one of percent or fixed value", async () => {
    const { po } = await makeServicePo("1000");
    const neither = await withTenant(tenant.id, (tx) =>
      createMilestone(tx, tenant.id, requestor.id, po.id, { milestoneNo: 1, description: "Kickoff", percentOfValue: null, fixedValue: null, dueDate: null }),
    );
    expect(neither.error).toBeDefined();

    const both = await withTenant(tenant.id, (tx) =>
      createMilestone(tx, tenant.id, requestor.id, po.id, { milestoneNo: 1, description: "Kickoff", percentOfValue: "50", fixedValue: "500", dueDate: null }),
    );
    expect(both.error).toBeDefined();
  });

  it("rejects a duplicate milestone number for the same PO", async () => {
    const { po } = await makeServicePo("1000");
    const first = await withTenant(tenant.id, (tx) =>
      createMilestone(tx, tenant.id, requestor.id, po.id, { milestoneNo: 1, description: "Kickoff", percentOfValue: "50", fixedValue: null, dueDate: null }),
    );
    expect(first.error).toBeUndefined();

    const dup = await withTenant(tenant.id, (tx) =>
      createMilestone(tx, tenant.id, requestor.id, po.id, { milestoneNo: 1, description: "Kickoff again", percentOfValue: "50", fixedValue: null, dueDate: null }),
    );
    expect(dup.error).toBeDefined();
  });

  it("resolves percent-of-value against the PO total, and fixed value as-is", async () => {
    const { po } = await makeServicePo("2000");
    const { milestoneId: percentId } = await withTenant(tenant.id, (tx) =>
      createMilestone(tx, tenant.id, requestor.id, po.id, { milestoneNo: 1, description: "Design", percentOfValue: "25", fixedValue: null, dueDate: null }),
    );
    const { milestoneId: fixedId } = await withTenant(tenant.id, (tx) =>
      createMilestone(tx, tenant.id, requestor.id, po.id, { milestoneNo: 2, description: "Build", percentOfValue: null, fixedValue: "600", dueDate: null }),
    );
    const [percentMilestone] = await withTenant(tenant.id, (tx) => tx.select().from(serviceMilestones).where(eq(serviceMilestones.id, percentId!)));
    const [fixedMilestone] = await withTenant(tenant.id, (tx) => tx.select().from(serviceMilestones).where(eq(serviceMilestones.id, fixedId!)));

    expect(resolveMilestoneValue(percentMilestone, po.totalAmount)).toBe(500);
    expect(resolveMilestoneValue(fixedMilestone, po.totalAmount)).toBe(600);
  });
});

describe("milestone-based service acceptance", () => {
  it("stays partially_fulfilled until every PO milestone is accepted for the line, then fulfills the PO", async () => {
    const { po, poLine } = await makeServicePo("3000");
    const m1 = await withTenant(tenant.id, (tx) => createMilestone(tx, tenant.id, requestor.id, po.id, { milestoneNo: 1, description: "Design", percentOfValue: "30", fixedValue: null, dueDate: null }));
    const m2 = await withTenant(tenant.id, (tx) => createMilestone(tx, tenant.id, requestor.id, po.id, { milestoneNo: 2, description: "Build", percentOfValue: "40", fixedValue: null, dueDate: null }));
    const m3 = await withTenant(tenant.id, (tx) => createMilestone(tx, tenant.id, requestor.id, po.id, { milestoneNo: 3, description: "Handover", percentOfValue: "30", fixedValue: null, dueDate: null }));

    await withTenant(tenant.id, (tx) =>
      recordServiceAcceptance(tx, tenant.id, requestor.id, po.id, [{ poLineId: poLine.id, milestoneId: m1.milestoneId!, acceptedValue: "900", status: "accepted", rejectionReason: null }]),
    );
    const [afterM1] = await withTenant(tenant.id, (tx) => tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.id, poLine.id)));
    expect(afterM1.status).toBe("partially_fulfilled");

    await withTenant(tenant.id, (tx) =>
      recordServiceAcceptance(tx, tenant.id, requestor.id, po.id, [{ poLineId: poLine.id, milestoneId: m2.milestoneId!, acceptedValue: "1200", status: "accepted", rejectionReason: null }]),
    );
    const [afterM2] = await withTenant(tenant.id, (tx) => tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.id, poLine.id)));
    expect(afterM2.status).toBe("partially_fulfilled");

    await withTenant(tenant.id, (tx) =>
      recordServiceAcceptance(tx, tenant.id, requestor.id, po.id, [{ poLineId: poLine.id, milestoneId: m3.milestoneId!, acceptedValue: "900", status: "accepted", rejectionReason: null }]),
    );
    const [afterM3] = await withTenant(tenant.id, (tx) => tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.id, poLine.id)));
    expect(afterM3.status).toBe("fulfilled");

    const [poAfter] = await withTenant(tenant.id, (tx) => tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id)));
    expect(poAfter.status).toBe("fulfilled");
  });

  it("leaves the line status untouched when a milestone is rejected, so it can be resubmitted", async () => {
    const { po, poLine } = await makeServicePo("1000");
    const m1 = await withTenant(tenant.id, (tx) => createMilestone(tx, tenant.id, requestor.id, po.id, { milestoneNo: 1, description: "Kickoff", percentOfValue: "100", fixedValue: null, dueDate: null }));
    const statusBefore = poLine.status;

    await withTenant(tenant.id, (tx) =>
      recordServiceAcceptance(tx, tenant.id, requestor.id, po.id, [{ poLineId: poLine.id, milestoneId: m1.milestoneId!, acceptedValue: "0", status: "rejected", rejectionReason: "not ready" }]),
    );
    const [afterReject] = await withTenant(tenant.id, (tx) => tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.id, poLine.id)));
    expect(afterReject.status).toBe(statusBefore);

    await withTenant(tenant.id, (tx) =>
      recordServiceAcceptance(tx, tenant.id, requestor.id, po.id, [{ poLineId: poLine.id, milestoneId: m1.milestoneId!, acceptedValue: "1000", status: "accepted", rejectionReason: null }]),
    );
    const [afterAccept] = await withTenant(tenant.id, (tx) => tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.id, poLine.id)));
    expect(afterAccept.status).toBe("fulfilled");
  });

  it("matches an invoice against the sum of accepted milestone values, excluding a rejected resubmission attempt", async () => {
    const { po, poLine } = await makeServicePo("1000");
    const m1 = await withTenant(tenant.id, (tx) => createMilestone(tx, tenant.id, requestor.id, po.id, { milestoneNo: 1, description: "Phase 1", percentOfValue: "50", fixedValue: null, dueDate: null }));
    const m2 = await withTenant(tenant.id, (tx) => createMilestone(tx, tenant.id, requestor.id, po.id, { milestoneNo: 2, description: "Phase 2", percentOfValue: "50", fixedValue: null, dueDate: null }));

    // A rejected attempt at milestone 2 first — its acceptedValue must not
    // leak into the invoice match once it's properly accepted afterward.
    await withTenant(tenant.id, (tx) =>
      recordServiceAcceptance(tx, tenant.id, requestor.id, po.id, [{ poLineId: poLine.id, milestoneId: m2.milestoneId!, acceptedValue: "500", status: "rejected", rejectionReason: "incomplete" }]),
    );
    await withTenant(tenant.id, (tx) =>
      recordServiceAcceptance(tx, tenant.id, requestor.id, po.id, [
        { poLineId: poLine.id, milestoneId: m1.milestoneId!, acceptedValue: "500", status: "accepted", rejectionReason: null },
      ]),
    );
    await withTenant(tenant.id, (tx) =>
      recordServiceAcceptance(tx, tenant.id, requestor.id, po.id, [
        { poLineId: poLine.id, milestoneId: m2.milestoneId!, acceptedValue: "500", status: "accepted", rejectionReason: null },
      ]),
    );

    const { invoiceId } = await withTenant(tenant.id, async (tx) => {
      const [invoice] = await tx
        .insert(invoices)
        .values({ tenantId: tenant.id, vendorId: vendor.id, poId: po.id, invoiceNumber: "INV-MS-001", invoiceDate: "2026-01-01", totalAmount: "1000" })
        .returning();
      await tx.insert(invoiceLines).values({ tenantId: tenant.id, invoiceId: invoice.id, poLineId: poLine.id, quantity: "1", unitPrice: "1000", lineTotal: "1000" });
      return { invoiceId: invoice.id };
    });

    const result = await withTenant(tenant.id, (tx) => matchInvoice(tx, tenant.id, invoiceId));
    expect(result.status).toBe("matched");

    const [invoiceLine] = await withTenant(tenant.id, (tx) => tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId)));
    const [match] = await withTenant(tenant.id, (tx) => tx.select().from(invoiceLineMatches).where(eq(invoiceLineMatches.invoiceLineId, invoiceLine.id)));
    expect(Number(match.matchedValue)).toBe(1000);
  });
});
