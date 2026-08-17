import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "../adminClient";
import { withTenant } from "../withTenant";
import { resolveClarificationHrefs } from "../clarificationLinks";
import {
  departments,
  goodsReceiptNotes,
  purchaseOrders,
  purchaseRequisitions,
  rfqs,
  tenants,
  users,
  vendorQuotations,
  vendors,
} from "../schema";

/**
 * Where a query on a record actually takes you.
 *
 * This existed as a static entityType -> `/route/${entityId}` map and three
 * of its five entries handed an id to a route keyed by a different entity,
 * so the link 404'd. The two below are the ones a string can never get
 * right — a goods receipt and a quotation have no page of their own, so
 * reaching them means joining to the PO or requisition they belong to.
 *
 * Worth a test precisely because the failure is invisible: a wrong href
 * still renders, still looks like a link, and only fails when somebody
 * clicks it.
 */

let tenant: typeof tenants.$inferSelect;
let requisition: typeof purchaseRequisitions.$inferSelect;
let po: typeof purchaseOrders.$inferSelect;
let grn: typeof goodsReceiptNotes.$inferSelect;
let quotation: typeof vendorQuotations.$inferSelect;

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  [tenant] = await adminDb
    .insert(tenants)
    .values({ name: "Clarification Links Test", slug: `clar-links-${suffix}` })
    .returning();

  await withTenant(tenant.id, async (tx) => {
    const [dept] = await tx.insert(departments).values({ tenantId: tenant.id, name: "Ops" }).returning();
    const [requestor] = await tx
      .insert(users)
      .values({ tenantId: tenant.id, email: `req-${suffix}@example.com`, fullName: "Requestor", status: "active" })
      .returning();
    const [vendor] = await tx
      .insert(vendors)
      .values({ tenantId: tenant.id, name: "Sundaram Traders", status: "active" })
      .returning();

    [requisition] = await tx
      .insert(purchaseRequisitions)
      .values({
        tenantId: tenant.id,
        requestorId: requestor.id,
        departmentId: dept.id,
        status: "approved",
        totalEstimatedValue: "12000",
      })
      .returning();

    [po] = await tx
      .insert(purchaseOrders)
      .values({
        tenantId: tenant.id,
        requisitionId: requisition.id,
        vendorId: vendor.id,
        poNumber: `PO-${suffix}`,
        status: "issued",
        totalAmount: "12000",
      })
      .returning();

    [grn] = await tx
      .insert(goodsReceiptNotes)
      .values({ tenantId: tenant.id, poId: po.id, deliveryNoteRef: "DN-1" })
      .returning();

    const [rfq] = await tx
      .insert(rfqs)
      .values({ tenantId: tenant.id, requisitionId: requisition.id, status: "open" })
      .returning();

    [quotation] = await tx
      .insert(vendorQuotations)
      .values({ tenantId: tenant.id, rfqId: rfq.id, vendorId: vendor.id, totalAmount: "11800" })
      .returning();
  });
});

afterAll(async () => {
  await adminDb.delete(vendorQuotations).where(eq(vendorQuotations.tenantId, tenant.id));
  await adminDb.delete(rfqs).where(eq(rfqs.tenantId, tenant.id));
  await adminDb.delete(goodsReceiptNotes).where(eq(goodsReceiptNotes.tenantId, tenant.id));
  await adminDb.delete(purchaseOrders).where(eq(purchaseOrders.tenantId, tenant.id));
  await adminDb.delete(purchaseRequisitions).where(eq(purchaseRequisitions.tenantId, tenant.id));
  await adminDb.delete(vendors).where(eq(vendors.tenantId, tenant.id));
  await adminDb.delete(users).where(eq(users.tenantId, tenant.id));
  await adminDb.delete(departments).where(eq(departments.tenantId, tenant.id));
  await adminDb.delete(tenants).where(eq(tenants.id, tenant.id));
});

describe("clarification links", () => {
  it("sends a goods-receipt query to the PO it was received against", async () => {
    const hrefs = await withTenant(tenant.id, (tx) =>
      resolveClarificationHrefs(tx, [{ entityType: "goods_receipt", entityId: grn.id }]),
    );

    // Not /dashboard/fulfillment/<grn.id> — that route is keyed by PO id,
    // which is exactly the bug this replaced.
    expect(hrefs.get(`goods_receipt:${grn.id}`)).toBe(`/dashboard/fulfillment/${po.id}`);
  });

  it("sends a quotation query to the requisition being sourced, two hops up", async () => {
    const hrefs = await withTenant(tenant.id, (tx) =>
      resolveClarificationHrefs(tx, [{ entityType: "quotation", entityId: quotation.id }]),
    );

    expect(hrefs.get(`quotation:${quotation.id}`)).toBe(`/dashboard/sourcing/${requisition.id}`);
  });

  it("keys a purchase-order query by the PO itself, on the fulfillment route", async () => {
    const hrefs = await withTenant(tenant.id, (tx) =>
      resolveClarificationHrefs(tx, [{ entityType: "purchase_order", entityId: po.id }]),
    );

    expect(hrefs.get(`purchase_order:${po.id}`)).toBe(`/dashboard/fulfillment/${po.id}`);
  });

  it("omits a subject that no longer exists rather than inventing a link", async () => {
    const missing = crypto.randomUUID();
    const hrefs = await withTenant(tenant.id, (tx) =>
      resolveClarificationHrefs(tx, [{ entityType: "goods_receipt", entityId: missing }]),
    );

    expect(hrefs.has(`goods_receipt:${missing}`)).toBe(false);
  });

  it("resolves a mixed batch in one pass", async () => {
    const hrefs = await withTenant(tenant.id, (tx) =>
      resolveClarificationHrefs(tx, [
        { entityType: "requisition", entityId: requisition.id },
        { entityType: "goods_receipt", entityId: grn.id },
        { entityType: "quotation", entityId: quotation.id },
      ]),
    );

    expect(hrefs.size).toBe(3);
    expect(hrefs.get(`requisition:${requisition.id}`)).toBe(`/dashboard/requisitions/${requisition.id}`);
  });
});
