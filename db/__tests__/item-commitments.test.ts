import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "../adminClient";
import { withTenant } from "../withTenant";
import { getOpenCommitmentsForItem } from "../itemCommitments";
import {
  tenants,
  users,
  vendors,
  catalogItems,
  purchaseRequisitions,
  purchaseRequisitionLines,
  purchaseOrders,
  purchaseOrderLines,
  goodsReceiptLines,
  goodsReceiptNotes,
} from "../schema";

let tenant: typeof tenants.$inferSelect;
let requestor: typeof users.$inferSelect;
let receiver: typeof users.$inferSelect;
let vendor: typeof vendors.$inferSelect;
let item: typeof catalogItems.$inferSelect;

async function makeConvertedRequisition() {
  const [requisition] = await withTenant(tenant.id, (tx) =>
    tx.insert(purchaseRequisitions).values({ tenantId: tenant.id, requestorId: requestor.id, status: "converted_to_po", totalEstimatedValue: "1000" }).returning(),
  );
  return requisition;
}

async function makePoLine(requisitionId: string, quantity: string, uom: string, poStatus: "issued" | "partially_fulfilled" | "cancelled", lineStatus: "issued" | "partially_fulfilled" | "fulfilled" | "cancelled") {
  return withTenant(tenant.id, async (tx) => {
    const [po] = await tx
      .insert(purchaseOrders)
      .values({
        tenantId: tenant.id,
        requisitionId,
        vendorId: vendor.id,
        poNumber: `PO-IC-${Math.random().toString(36).slice(2, 8)}`,
        status: poStatus,
        totalAmount: "1000",
      })
      .returning();
    const [poLine] = await tx
      .insert(purchaseOrderLines)
      .values({ tenantId: tenant.id, poId: po.id, fulfillmentType: "goods", itemId: item.id, quantity, uom, unitPrice: "100", lineTotal: "1000", status: lineStatus })
      .returning();
    return { po, poLine };
  });
}

async function receive(poId: string, poLineId: string, quantityAccepted: string) {
  await withTenant(tenant.id, async (tx) => {
    const [grn] = await tx.insert(goodsReceiptNotes).values({ tenantId: tenant.id, poId, receivedBy: receiver.id, status: "completed" }).returning();
    await tx.insert(goodsReceiptLines).values({
      tenantId: tenant.id,
      grnId: grn.id,
      poLineId,
      quantityDelivered: quantityAccepted,
      quantityAccepted,
      quantityRejected: "0",
      condition: "good",
      verifiedBy: receiver.id,
    });
  });
}

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  [tenant] = await adminDb.insert(tenants).values({ name: "Item Commitments Co", slug: `item-commitments-co-${suffix}` }).returning();
  [requestor] = await adminDb.insert(users).values({ tenantId: tenant.id, email: "ic-requestor@example.com", fullName: "Priya Requestor", status: "active" }).returning();
  [receiver] = await adminDb.insert(users).values({ tenantId: tenant.id, email: "ic-receiver@example.com", fullName: "Rahul Receiver", status: "active" }).returning();
  await withTenant(tenant.id, async (tx) => {
    [vendor] = await tx.insert(vendors).values({ tenantId: tenant.id, name: "Kalyani Steels" }).returning();
    [item] = await tx.insert(catalogItems).values({ tenantId: tenant.id, name: "SKF 6205 bearing" }).returning();
  });
});

afterAll(async () => {
  const tables = [
    goodsReceiptLines, goodsReceiptNotes, purchaseOrderLines, purchaseOrders,
    purchaseRequisitionLines, purchaseRequisitions, catalogItems, vendors, users,
  ];
  for (const table of tables) {
    await adminDb.delete(table).where(sql`tenant_id = ${tenant.id}`);
  }
  await adminDb.delete(tenants).where(eq(tenants.id, tenant.id));
});

describe("getOpenCommitmentsForItem", () => {
  it("reports the full quantity outstanding for a PO line with no receipts", async () => {
    const requisition = await makeConvertedRequisition();
    const { po } = await makePoLine(requisition.id, "12", "each", "issued", "issued");

    const groups = await withTenant(tenant.id, (tx) => getOpenCommitmentsForItem(tx, item.id));
    const each = groups.find((g) => g.uom === "each");
    expect(each?.onOrderTotal).toBe(12);
    expect(each?.onOrder).toEqual([{ poNumber: po.poNumber, vendorName: "Kalyani Steels", outstandingQuantity: 12 }]);
  });

  it("reports only the balance for a partially received line, using the summed definition not the raw quantity", async () => {
    const requisition = await makeConvertedRequisition();
    const { po, poLine } = await makePoLine(requisition.id, "10", "each", "partially_fulfilled", "partially_fulfilled");
    await receive(po.id, poLine.id, "6");
    await receive(po.id, poLine.id, "1");

    const groups = await withTenant(tenant.id, (tx) => getOpenCommitmentsForItem(tx, item.id));
    const each = groups.find((g) => g.uom === "each");
    const ref = each?.onOrder.find((r) => r.poNumber === po.poNumber);
    expect(ref?.outstandingQuantity).toBe(3);
  });

  it("excludes a fully received line", async () => {
    const requisition = await makeConvertedRequisition();
    const { po, poLine } = await makePoLine(requisition.id, "5", "each", "issued", "fulfilled");
    await receive(po.id, poLine.id, "5");

    const groups = await withTenant(tenant.id, (tx) => getOpenCommitmentsForItem(tx, item.id));
    const each = groups.find((g) => g.uom === "each");
    expect(each?.onOrder.some((r) => r.poNumber === po.poNumber)).toBe(false);
  });

  it("excludes a cancelled PO", async () => {
    const requisition = await makeConvertedRequisition();
    const { po } = await makePoLine(requisition.id, "8", "each", "cancelled", "cancelled");

    const groups = await withTenant(tenant.id, (tx) => getOpenCommitmentsForItem(tx, item.id));
    const each = groups.find((g) => g.uom === "each");
    expect(each?.onOrder.some((r) => r.poNumber === po.poNumber)).toBe(false);
  });

  it("does not double-count a converted_to_po requisition — it shows on-order, not pipeline", async () => {
    const requisition = await makeConvertedRequisition();
    await makePoLine(requisition.id, "4", "each", "issued", "issued");

    // The requisition line itself, matching the PO it was converted into.
    await withTenant(tenant.id, (tx) =>
      tx.insert(purchaseRequisitionLines).values({
        tenantId: tenant.id,
        requisitionId: requisition.id,
        catalogItemId: item.id,
        fulfillmentType: "goods",
        quantity: "4",
        uom: "each",
        estimatedUnitPrice: "100",
        lineTotal: "400",
      }),
    );

    const groups = await withTenant(tenant.id, (tx) => getOpenCommitmentsForItem(tx, item.id));
    const each = groups.find((g) => g.uom === "each");
    expect(each?.onOrderTotal).toBeGreaterThanOrEqual(4);
    expect(each?.pipeline.some((r) => r.requisitionId === requisition.id)).toBe(false);
  });

  it("excludes a draft requisition from the pipeline figure", async () => {
    const [draft] = await withTenant(tenant.id, (tx) =>
      tx.insert(purchaseRequisitions).values({ tenantId: tenant.id, requestorId: requestor.id, status: "draft", totalEstimatedValue: "200" }).returning(),
    );
    await withTenant(tenant.id, (tx) =>
      tx.insert(purchaseRequisitionLines).values({
        tenantId: tenant.id,
        requisitionId: draft.id,
        catalogItemId: item.id,
        fulfillmentType: "goods",
        quantity: "2",
        uom: "each",
        estimatedUnitPrice: "100",
        lineTotal: "200",
      }),
    );

    const groups = await withTenant(tenant.id, (tx) => getOpenCommitmentsForItem(tx, item.id));
    const each = groups.find((g) => g.uom === "each");
    expect(each?.pipeline.some((r) => r.requisitionId === draft.id)).toBe(false);
  });

  it("reports a submitted requisition's quantity in the pipeline", async () => {
    const [submitted] = await withTenant(tenant.id, (tx) =>
      tx.insert(purchaseRequisitions).values({ tenantId: tenant.id, requestorId: requestor.id, status: "submitted", totalEstimatedValue: "500" }).returning(),
    );
    await withTenant(tenant.id, (tx) =>
      tx.insert(purchaseRequisitionLines).values({
        tenantId: tenant.id,
        requisitionId: submitted.id,
        catalogItemId: item.id,
        fulfillmentType: "goods",
        quantity: "5",
        uom: "each",
        estimatedUnitPrice: "100",
        lineTotal: "500",
      }),
    );

    const groups = await withTenant(tenant.id, (tx) => getOpenCommitmentsForItem(tx, item.id));
    const each = groups.find((g) => g.uom === "each");
    const ref = each?.pipeline.find((r) => r.requisitionId === submitted.id);
    expect(ref?.quantity).toBe(5);
    expect(ref?.status).toBe("submitted");
    expect(ref?.requestorName).toBe("Priya Requestor");
  });

  it("reports differing uoms as separate groups rather than summing them", async () => {
    const requisition = await makeConvertedRequisition();
    await makePoLine(requisition.id, "12", "each", "issued", "issued");
    await makePoLine(requisition.id, "3", "boxes", "issued", "issued");

    const groups = await withTenant(tenant.id, (tx) => getOpenCommitmentsForItem(tx, item.id));
    const each = groups.find((g) => g.uom === "each");
    const boxes = groups.find((g) => g.uom === "boxes");
    expect(each).toBeDefined();
    expect(boxes).toBeDefined();
    expect(boxes?.onOrderTotal).toBe(3);
    // Distinct groups — nothing here adds the "each" figure to the "boxes" figure.
    expect(groups.length).toBeGreaterThanOrEqual(2);
  });
});
