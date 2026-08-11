import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "../adminClient";
import { withTenant } from "../withTenant";
import { recordGoodsReceipt, recordServiceAcceptance } from "../fulfillment";
import { matchInvoice } from "../invoiceMatch";
import { advanceVendorReturn, initiateVendorReturn } from "../vendorReturns";
import {
  tenants,
  users,
  vendors,
  purchaseRequisitions,
  purchaseOrders,
  purchaseOrderLines,
  goodsReceiptLines,
  goodsReceiptNotes,
  serviceAcceptanceLines,
  serviceAcceptances,
  vendorReturns,
  invoices,
  invoiceLines,
  invoiceLineMatches,
  auditLog,
} from "../schema";

let tenant: typeof tenants.$inferSelect;
let requestor: typeof users.$inferSelect;
let receiver: typeof users.$inferSelect;
let vendor: typeof vendors.$inferSelect;

async function makeGoodsPo(quantity: string) {
  return withTenant(tenant.id, async (tx) => {
    const [requisition] = await tx
      .insert(purchaseRequisitions)
      .values({ tenantId: tenant.id, requestorId: requestor.id, status: "converted_to_po", totalEstimatedValue: "1000" })
      .returning();
    const [po] = await tx
      .insert(purchaseOrders)
      .values({ tenantId: tenant.id, requisitionId: requisition.id, vendorId: vendor.id, poNumber: `PO-PD-${Math.random().toString(36).slice(2, 8)}`, status: "issued", totalAmount: "1000" })
      .returning();
    const [poLine] = await tx
      .insert(purchaseOrderLines)
      .values({ tenantId: tenant.id, poId: po.id, fulfillmentType: "goods", quantity, uom: "each", unitPrice: "100", lineTotal: "1000", status: "issued" })
      .returning();
    return { po, poLine };
  });
}

async function makeServicePo() {
  return withTenant(tenant.id, async (tx) => {
    const [requisition] = await tx
      .insert(purchaseRequisitions)
      .values({ tenantId: tenant.id, requestorId: requestor.id, status: "converted_to_po", totalEstimatedValue: "500" })
      .returning();
    const [po] = await tx
      .insert(purchaseOrders)
      .values({ tenantId: tenant.id, requisitionId: requisition.id, vendorId: vendor.id, poNumber: `PO-SVC-${Math.random().toString(36).slice(2, 8)}`, status: "issued", totalAmount: "500" })
      .returning();
    const [poLine] = await tx
      .insert(purchaseOrderLines)
      .values({ tenantId: tenant.id, poId: po.id, fulfillmentType: "service", serviceDescription: "Install", quantity: "1", uom: "each", unitPrice: "500", lineTotal: "500", status: "issued" })
      .returning();
    return { po, poLine };
  });
}

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  [tenant] = await adminDb.insert(tenants).values({ name: "Partial Delivery Co", slug: `partial-delivery-co-${suffix}` }).returning();
  [requestor] = await adminDb.insert(users).values({ tenantId: tenant.id, email: "pd-requestor@example.com", fullName: "Pat Requestor", status: "active" }).returning();
  [receiver] = await adminDb.insert(users).values({ tenantId: tenant.id, email: "pd-receiver@example.com", fullName: "Rae Receiver", status: "active" }).returning();
  [vendor] = await withTenant(tenant.id, (tx) => tx.insert(vendors).values({ tenantId: tenant.id, name: "Partial Vendor" }).returning());
});

afterAll(async () => {
  const tables = [
    auditLog, invoiceLineMatches, invoiceLines, invoices, vendorReturns,
    goodsReceiptLines, goodsReceiptNotes, serviceAcceptanceLines, serviceAcceptances,
    purchaseOrderLines, purchaseOrders, purchaseRequisitions, vendors, users,
  ];
  for (const table of tables) {
    await adminDb.delete(table).where(sql`tenant_id = ${tenant.id}`);
  }
  await adminDb.delete(tenants).where(eq(tenants.id, tenant.id));
});

describe("partial/staged goods delivery", () => {
  it("stays partially_fulfilled across multiple receipts, then fulfilled once the running total meets the ordered quantity", async () => {
    const { po, poLine } = await makeGoodsPo("10");

    await withTenant(tenant.id, (tx) =>
      recordGoodsReceipt(tx, tenant.id, requestor.id, po.id, receiver.id, "DN-1", [
        { poLineId: poLine.id, quantityDelivered: "6", quantityAccepted: "6", quantityRejected: "0", condition: "good", rejectionReason: null },
      ]),
    );
    const [afterFirst] = await withTenant(tenant.id, (tx) => tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.id, poLine.id)));
    expect(afterFirst.status).toBe("partially_fulfilled");
    const [poAfterFirst] = await withTenant(tenant.id, (tx) => tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id)));
    expect(poAfterFirst.status).not.toBe("fulfilled");

    await withTenant(tenant.id, (tx) =>
      recordGoodsReceipt(tx, tenant.id, requestor.id, po.id, receiver.id, "DN-2", [
        { poLineId: poLine.id, quantityDelivered: "4", quantityAccepted: "4", quantityRejected: "0", condition: "good", rejectionReason: null },
      ]),
    );
    const [afterSecond] = await withTenant(tenant.id, (tx) => tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.id, poLine.id)));
    expect(afterSecond.status).toBe("fulfilled");
    const [poAfterSecond] = await withTenant(tenant.id, (tx) => tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id)));
    expect(poAfterSecond.status).toBe("fulfilled");
  });

  it("matches an invoice against the cumulative accepted quantity across receipts, not just the first one", async () => {
    const { po, poLine } = await makeGoodsPo("10");

    await withTenant(tenant.id, (tx) =>
      recordGoodsReceipt(tx, tenant.id, requestor.id, po.id, receiver.id, "DN-A", [
        { poLineId: poLine.id, quantityDelivered: "6", quantityAccepted: "6", quantityRejected: "0", condition: "good", rejectionReason: null },
      ]),
    );
    await withTenant(tenant.id, (tx) =>
      recordGoodsReceipt(tx, tenant.id, requestor.id, po.id, receiver.id, "DN-B", [
        { poLineId: poLine.id, quantityDelivered: "4", quantityAccepted: "4", quantityRejected: "0", condition: "good", rejectionReason: null },
      ]),
    );

    const { invoiceId } = await withTenant(tenant.id, async (tx) => {
      const [invoice] = await tx
        .insert(invoices)
        .values({ tenantId: tenant.id, vendorId: vendor.id, poId: po.id, invoiceNumber: "INV-PD-001", invoiceDate: "2026-01-01", totalAmount: "1000" })
        .returning();
      await tx.insert(invoiceLines).values({ tenantId: tenant.id, invoiceId: invoice.id, poLineId: poLine.id, quantity: "10", unitPrice: "100", lineTotal: "1000" });
      return { invoiceId: invoice.id };
    });

    const result = await withTenant(tenant.id, (tx) => matchInvoice(tx, tenant.id, invoiceId));
    expect(result.status).toBe("matched");

    const [invoiceLine] = await withTenant(tenant.id, (tx) => tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId)));
    const [match] = await withTenant(tenant.id, (tx) => tx.select().from(invoiceLineMatches).where(eq(invoiceLineMatches.invoiceLineId, invoiceLine.id)));
    expect(Number(match.matchedQuantity)).toBe(10);
  });

  it("would exception a partial invoice billed against only the first shipment (matched quantity is the sum, not the first row)", async () => {
    const { po, poLine } = await makeGoodsPo("10");
    await withTenant(tenant.id, (tx) =>
      recordGoodsReceipt(tx, tenant.id, requestor.id, po.id, receiver.id, "DN-C", [
        { poLineId: poLine.id, quantityDelivered: "6", quantityAccepted: "6", quantityRejected: "0", condition: "good", rejectionReason: null },
      ]),
    );
    await withTenant(tenant.id, (tx) =>
      recordGoodsReceipt(tx, tenant.id, requestor.id, po.id, receiver.id, "DN-D", [
        { poLineId: poLine.id, quantityDelivered: "4", quantityAccepted: "4", quantityRejected: "0", condition: "good", rejectionReason: null },
      ]),
    );

    const { invoiceId } = await withTenant(tenant.id, async (tx) => {
      const [invoice] = await tx
        .insert(invoices)
        .values({ tenantId: tenant.id, vendorId: vendor.id, poId: po.id, invoiceNumber: "INV-PD-002", invoiceDate: "2026-01-01", totalAmount: "600" })
        .returning();
      // Billed for only the first shipment's quantity — the pre-S17 bug
      // would've happened to "match" this against a single stored row;
      // now it should exception, since 6 != the true running total of 10.
      await tx.insert(invoiceLines).values({ tenantId: tenant.id, invoiceId: invoice.id, poLineId: poLine.id, quantity: "6", unitPrice: "100", lineTotal: "600" });
      return { invoiceId: invoice.id };
    });

    const result = await withTenant(tenant.id, (tx) => matchInvoice(tx, tenant.id, invoiceId));
    expect(result.status).toBe("exception");
  });
});

describe("quality rejection -> vendor return lifecycle", () => {
  it("initiates a return for the rejected quantity and rejects over-quantity attempts", async () => {
    const { po, poLine } = await makeGoodsPo("10");
    await withTenant(tenant.id, (tx) =>
      recordGoodsReceipt(tx, tenant.id, requestor.id, po.id, receiver.id, "DN-R1", [
        { poLineId: poLine.id, quantityDelivered: "10", quantityAccepted: "7", quantityRejected: "3", condition: "damaged", rejectionReason: "cracked casing" },
      ]),
    );
    const [afterReceipt] = await withTenant(tenant.id, (tx) => tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.id, poLine.id)));
    expect(afterReceipt.status).toBe("partially_fulfilled");

    const [grnLine] = await withTenant(tenant.id, (tx) => tx.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.poLineId, poLine.id)));

    const tooMuch = await withTenant(tenant.id, (tx) => initiateVendorReturn(tx, tenant.id, requestor.id, grnLine.id, "5", "cracked casing"));
    expect(tooMuch.error).toBeDefined();

    const result = await withTenant(tenant.id, (tx) => initiateVendorReturn(tx, tenant.id, requestor.id, grnLine.id, "3", "cracked casing"));
    expect(result.error).toBeUndefined();
    expect(result.returnId).toBeDefined();

    const [created] = await withTenant(tenant.id, (tx) => tx.select().from(vendorReturns).where(eq(vendorReturns.id, result.returnId!)));
    expect(created.status).toBe("initiated");
    expect(created.quantity).toBe("3.000");
  });

  it("advances one status step at a time, requiring a reference for shipped and credited", async () => {
    const { po, poLine } = await makeGoodsPo("5");
    await withTenant(tenant.id, (tx) =>
      recordGoodsReceipt(tx, tenant.id, requestor.id, po.id, receiver.id, "DN-R2", [
        { poLineId: poLine.id, quantityDelivered: "5", quantityAccepted: "3", quantityRejected: "2", condition: "short", rejectionReason: "short-shipped" },
      ]),
    );
    const [grnLine] = await withTenant(tenant.id, (tx) => tx.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.poLineId, poLine.id)));
    const { returnId } = await withTenant(tenant.id, (tx) => initiateVendorReturn(tx, tenant.id, requestor.id, grnLine.id, "2", "short-shipped"));

    const skipStep = await withTenant(tenant.id, (tx) => advanceVendorReturn(tx, tenant.id, requestor.id, returnId!, "credited", "CN-1"));
    expect(skipStep.error).toBeDefined();

    const noRef = await withTenant(tenant.id, (tx) => advanceVendorReturn(tx, tenant.id, requestor.id, returnId!, "shipped", null));
    expect(noRef.error).toBeDefined();

    const shipped = await withTenant(tenant.id, (tx) => advanceVendorReturn(tx, tenant.id, requestor.id, returnId!, "shipped", "RS-1"));
    expect(shipped.error).toBeUndefined();

    const credited = await withTenant(tenant.id, (tx) => advanceVendorReturn(tx, tenant.id, requestor.id, returnId!, "credited", "CN-1"));
    expect(credited.error).toBeUndefined();

    const closed = await withTenant(tenant.id, (tx) => advanceVendorReturn(tx, tenant.id, requestor.id, returnId!, "closed", null));
    expect(closed.error).toBeUndefined();

    const [final] = await withTenant(tenant.id, (tx) => tx.select().from(vendorReturns).where(eq(vendorReturns.id, returnId!)));
    expect(final.status).toBe("closed");
    expect(final.returnShipmentRef).toBe("RS-1");
    expect(final.creditNoteRef).toBe("CN-1");
  });
});

describe("service acceptance status handling", () => {
  it("marks fulfilled on accepted, partially_fulfilled on partial, and leaves rejected open for rework", async () => {
    const { po: acceptedPo, poLine: acceptedLine } = await makeServicePo();
    await withTenant(tenant.id, (tx) =>
      recordServiceAcceptance(tx, tenant.id, requestor.id, acceptedPo.id, [{ poLineId: acceptedLine.id, acceptedValue: "500", status: "accepted", rejectionReason: null }]),
    );
    const [afterAccepted] = await withTenant(tenant.id, (tx) => tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.id, acceptedLine.id)));
    expect(afterAccepted.status).toBe("fulfilled");

    const { po: partialPo, poLine: partialLine } = await makeServicePo();
    await withTenant(tenant.id, (tx) =>
      recordServiceAcceptance(tx, tenant.id, requestor.id, partialPo.id, [{ poLineId: partialLine.id, acceptedValue: "250", status: "partial", rejectionReason: null }]),
    );
    const [afterPartial] = await withTenant(tenant.id, (tx) => tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.id, partialLine.id)));
    expect(afterPartial.status).toBe("partially_fulfilled");

    const { po: rejectedPo, poLine: rejectedLine } = await makeServicePo();
    const statusBefore = rejectedLine.status;
    await withTenant(tenant.id, (tx) =>
      recordServiceAcceptance(tx, tenant.id, requestor.id, rejectedPo.id, [{ poLineId: rejectedLine.id, acceptedValue: "0", status: "rejected", rejectionReason: "incomplete work" }]),
    );
    const [afterRejected] = await withTenant(tenant.id, (tx) => tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.id, rejectedLine.id)));
    expect(afterRejected.status).toBe(statusBefore);
    expect(afterRejected.status).not.toBe("fulfilled");
  });
});
