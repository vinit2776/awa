import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "../adminClient";
import { withTenant } from "../withTenant";
import {
  findInvoiceIdsMatching,
  findPaymentIdsMatching,
  findPurchaseOrderIdsMatching,
} from "../pipelineSearch";
import {
  catalogItems,
  costCenters,
  departments,
  invoices,
  paymentInstructions,
  purchaseOrders,
  purchaseOrderLines,
  purchaseRequisitionLines,
  purchaseRequisitions,
  tenants,
  users,
  vendors,
} from "../schema";

/**
 * The inheritance rule: a record downstream of a requisition is findable
 * by anything true of that requisition.
 *
 * The case that matters is searching "helmet" on the payment queue. The
 * word appears on a requisition line three tables away — not on the
 * payment, not on the invoice, not on the PO. If that stops working, the
 * search boxes on those pages are only good for reference numbers, which
 * is not what anyone has in their head.
 */

let tenant: typeof tenants.$inferSelect;
let po: typeof purchaseOrders.$inferSelect;
let invoice: typeof invoices.$inferSelect;
let payment: typeof paymentInstructions.$inferSelect;
let otherPo: typeof purchaseOrders.$inferSelect;

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  [tenant] = await adminDb
    .insert(tenants)
    .values({ name: "Pipeline Search Co", slug: `pipeline-search-${suffix}` })
    .returning();

  await withTenant(tenant.id, async (tx) => {
    const [dept] = await tx.insert(departments).values({ tenantId: tenant.id, name: "Site Services" }).returning();
    const [cc] = await tx
      .insert(costCenters)
      .values({ tenantId: tenant.id, name: "Plant Two", code: `PL2-${suffix}` })
      .returning();
    const [requestor] = await tx
      .insert(users)
      .values({ tenantId: tenant.id, email: `meera-${suffix}@example.com`, fullName: "Meera Iyer", status: "active" })
      .returning();
    const [vendor] = await tx
      .insert(vendors)
      .values({ tenantId: tenant.id, name: "Kalyani Safety Supplies", status: "active" })
      .returning();
    const [helmet] = await tx
      .insert(catalogItems)
      .values({ tenantId: tenant.id, name: "Safety helmet", uom: "each" })
      .returning();

    const [requisition] = await tx
      .insert(purchaseRequisitions)
      .values({
        tenantId: tenant.id,
        requestorId: requestor.id,
        departmentId: dept.id,
        costCenterId: cc.id,
        status: "converted_to_po",
        totalEstimatedValue: "24000",
        justification: "Annual replacement for the fabrication bay",
      })
      .returning();
    await tx.insert(purchaseRequisitionLines).values({
      tenantId: tenant.id,
      requisitionId: requisition.id,
      catalogItemId: helmet.id,
      fulfillmentType: "goods",
      quantity: "40",
      uom: "each",
    });

    [po] = await tx
      .insert(purchaseOrders)
      .values({
        tenantId: tenant.id,
        requisitionId: requisition.id,
        vendorId: vendor.id,
        poNumber: `PO-PIPE-${suffix}`,
        status: "issued",
        totalAmount: "24000",
      })
      .returning();
    await tx.insert(purchaseOrderLines).values({
      tenantId: tenant.id,
      poId: po.id,
      itemId: helmet.id,
      fulfillmentType: "goods",
      quantity: "40",
      uom: "each",
    });

    [invoice] = await tx
      .insert(invoices)
      .values({
        tenantId: tenant.id,
        vendorId: vendor.id,
        poId: po.id,
        invoiceNumber: `KSS-${suffix}`,
        invoiceDate: "2026-08-01",
        totalAmount: "24000",
        status: "approved_for_payment",
      })
      .returning();

    [payment] = await tx
      .insert(paymentInstructions)
      .values({
        tenantId: tenant.id,
        invoiceId: invoice.id,
        amount: "24000",
        status: "failed",
        referenceNumber: `UTR${suffix}`,
        failureReason: "Beneficiary account frozen",
      })
      .returning();

    // An unrelated PO, so "matches everything" bugs are visible.
    const [otherReq] = await tx
      .insert(purchaseRequisitions)
      .values({ tenantId: tenant.id, requestorId: requestor.id, status: "converted_to_po", totalEstimatedValue: "900" })
      .returning();
    [otherPo] = await tx
      .insert(purchaseOrders)
      .values({
        tenantId: tenant.id,
        requisitionId: otherReq.id,
        vendorId: vendor.id,
        poNumber: `PO-OTHER-${suffix}`,
        status: "issued",
        totalAmount: "900",
      })
      .returning();
  });
});

afterAll(async () => {
  await adminDb.delete(paymentInstructions).where(eq(paymentInstructions.tenantId, tenant.id));
  await adminDb.delete(invoices).where(eq(invoices.tenantId, tenant.id));
  await adminDb.delete(purchaseOrderLines).where(eq(purchaseOrderLines.tenantId, tenant.id));
  await adminDb.delete(purchaseOrders).where(eq(purchaseOrders.tenantId, tenant.id));
  await adminDb.delete(purchaseRequisitionLines).where(eq(purchaseRequisitionLines.tenantId, tenant.id));
  await adminDb.delete(purchaseRequisitions).where(eq(purchaseRequisitions.tenantId, tenant.id));
  await adminDb.delete(catalogItems).where(eq(catalogItems.tenantId, tenant.id));
  await adminDb.delete(vendors).where(eq(vendors.tenantId, tenant.id));
  await adminDb.delete(costCenters).where(eq(costCenters.tenantId, tenant.id));
  await adminDb.delete(departments).where(eq(departments.tenantId, tenant.id));
  await adminDb.delete(users).where(eq(users.tenantId, tenant.id));
  await adminDb.delete(tenants).where(eq(tenants.id, tenant.id));
});

const pos = (q: string) => withTenant(tenant.id, (tx) => findPurchaseOrderIdsMatching(tx, q));
const invs = (q: string) => withTenant(tenant.id, (tx) => findInvoiceIdsMatching(tx, q));
const pays = (q: string) => withTenant(tenant.id, (tx) => findPaymentIdsMatching(tx, q));

describe("purchase order search", () => {
  it("finds a PO by its own number", async () => {
    expect(await pos(po.poNumber)).toContain(po.id);
  });

  it("finds a PO by vendor", async () => {
    expect(await pos("Kalyani")).toContain(po.id);
  });

  it("finds a PO by what the requisition behind it was for", async () => {
    expect(await pos("helmet")).toContain(po.id);
  });

  it("finds a PO by the requester, department or notes on that requisition", async () => {
    expect(await pos("Meera")).toContain(po.id);
    expect(await pos("Site Services")).toContain(po.id);
    expect(await pos("fabrication bay")).toContain(po.id);
  });

  it("does not return unrelated purchase orders", async () => {
    expect(await pos("helmet")).not.toContain(otherPo.id);
  });
});

describe("invoice search", () => {
  it("finds an invoice by its own number", async () => {
    expect(await invs(invoice.invoiceNumber)).toContain(invoice.id);
  });

  it("finds an invoice by what was bought, three tables away", async () => {
    expect(await invs("helmet")).toContain(invoice.id);
  });

  it("finds an invoice by the PO number behind it", async () => {
    expect(await invs(po.poNumber)).toContain(invoice.id);
  });
});

describe("payment search", () => {
  it("finds a payment by its bank reference", async () => {
    expect(await pays(payment.referenceNumber!)).toContain(payment.id);
  });

  it("finds a payment by why it failed", async () => {
    expect(await pays("frozen")).toContain(payment.id);
  });

  it("finds a payment by what was bought — the whole point of the inheritance rule", async () => {
    // "helmet" appears on a requisition line. Not on the payment, not on
    // the invoice, not on the PO header.
    expect(await pays("helmet")).toContain(payment.id);
  });

  it("finds a payment by the requester who raised the original requisition", async () => {
    expect(await pays("Meera")).toContain(payment.id);
  });
});

describe("shared rules", () => {
  it("returns nothing for an empty query rather than everything", async () => {
    expect(await pos("")).toEqual([]);
    expect(await invs("  ")).toEqual([]);
    expect(await pays("")).toEqual([]);
  });

  it("treats LIKE wildcards as literal characters", async () => {
    expect(await pos("%")).toEqual([]);
    expect(await invs("%")).toEqual([]);
    expect(await pays("%")).toEqual([]);
  });
});
