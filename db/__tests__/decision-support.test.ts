import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "../adminClient";
import { withTenant } from "../withTenant";
import { getCommittedByCostCenter } from "../budget";
import { getItemPurchaseHistory } from "../itemHistory";
import {
  tenants,
  users,
  vendors,
  costCenters,
  catalogItems,
  purchaseRequisitions,
  purchaseOrders,
  purchaseOrderLines,
} from "../schema";

let tenant: typeof tenants.$inferSelect;
let requestor: typeof users.$inferSelect;
let vendor: typeof vendors.$inferSelect;
let costCenter: typeof costCenters.$inferSelect;
let item: typeof catalogItems.$inferSelect;
let neverPurchasedItem: typeof catalogItems.$inferSelect;

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  [tenant] = await adminDb.insert(tenants).values({ name: "Decision Support Co", slug: `decision-support-co-${suffix}` }).returning();
  [requestor] = await adminDb.insert(users).values({ tenantId: tenant.id, email: "ds-requestor@example.com", fullName: "Rachel Requestor", status: "active" }).returning();

  await withTenant(tenant.id, async (tx) => {
    [vendor] = await tx.insert(vendors).values({ tenantId: tenant.id, name: "History Vendor" }).returning();
    [costCenter] = await tx.insert(costCenters).values({ tenantId: tenant.id, name: "DS-01", code: "DS-01" }).returning();
    [item] = await tx.insert(catalogItems).values({ tenantId: tenant.id, name: "Gate valve" }).returning();
    [neverPurchasedItem] = await tx.insert(catalogItems).values({ tenantId: tenant.id, name: "Never bought item" }).returning();
  });
});

afterAll(async () => {
  const tables = [purchaseOrderLines, purchaseOrders, purchaseRequisitions, catalogItems, costCenters, vendors, users];
  for (const table of tables) {
    await adminDb.delete(table).where(sql`tenant_id = ${tenant.id}`);
  }
  await adminDb.delete(tenants).where(eq(tenants.id, tenant.id));
});

describe("getCommittedByCostCenter", () => {
  it("excludes draft and cancelled requisitions but includes submitted/approved ones", async () => {
    await withTenant(tenant.id, async (tx) => {
      await tx.insert(purchaseRequisitions).values({ tenantId: tenant.id, requestorId: requestor.id, costCenterId: costCenter.id, status: "draft", totalEstimatedValue: "9999" });
      await tx.insert(purchaseRequisitions).values({ tenantId: tenant.id, requestorId: requestor.id, costCenterId: costCenter.id, status: "cancelled", totalEstimatedValue: "9999" });
      await tx.insert(purchaseRequisitions).values({ tenantId: tenant.id, requestorId: requestor.id, costCenterId: costCenter.id, status: "approved", totalEstimatedValue: "1000" });
      await tx.insert(purchaseRequisitions).values({ tenantId: tenant.id, requestorId: requestor.id, costCenterId: costCenter.id, status: "pending_approval", totalEstimatedValue: "500" });

      const committed = await getCommittedByCostCenter(tx);
      expect(committed[costCenter.id]).toBe(1500);
    });
  });
});

describe("getItemPurchaseHistory", () => {
  it("returns purchase history newest first, respecting the limit", async () => {
    // Postgres's now() resolves to transaction-start time, so these are
    // deliberately separate withTenant() calls (separate transactions) —
    // matching how real PO issuances actually happen (one per request) —
    // rather than one shared transaction, which would give every insert
    // the identical timestamp and make "newest first" untestable.
    const [req] = await withTenant(tenant.id, (tx) =>
      tx.insert(purchaseRequisitions).values({ tenantId: tenant.id, requestorId: requestor.id, status: "converted_to_po", totalEstimatedValue: "0" }).returning(),
    );

    for (const price of ["100", "110", "120", "130"]) {
      await withTenant(tenant.id, async (tx) => {
        const [po] = await tx.insert(purchaseOrders).values({
          tenantId: tenant.id, requisitionId: req.id, vendorId: vendor.id, poNumber: `PO-HIST-${price}`,
          status: "issued", totalAmount: price,
        }).returning();
        await tx.insert(purchaseOrderLines).values({
          tenantId: tenant.id, poId: po.id, fulfillmentType: "goods", itemId: item.id,
          quantity: "1", unitPrice: price, lineTotal: price, status: "issued",
        });
      });
    }

    const history = await withTenant(tenant.id, (tx) => getItemPurchaseHistory(tx, item.id, 2));
    expect(history).toHaveLength(2);
    // Most recently created PO first.
    expect(history[0].unitPrice).toBe("130.00");
    expect(history[1].unitPrice).toBe("120.00");
    expect(history[0].vendorName).toBe("History Vendor");
  });

  it("returns an empty list for an item that's never been purchased", async () => {
    const history = await withTenant(tenant.id, (tx) => getItemPurchaseHistory(tx, neverPurchasedItem.id));
    expect(history).toHaveLength(0);
  });
});
