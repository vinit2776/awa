// One-off demo-data seeder. Reuses the app's own business-logic
// functions (resolveApprovals, issuePurchaseOrder, recordGoodsReceipt,
// matchInvoice, etc.) instead of hand-rolled SQL, so every row this
// produces obeys the same constraints/triggers/side effects a real user
// action would. Run with: npx tsx scripts/seedAllModules.ts
// Not part of the app — never imported from application code.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, and } from "drizzle-orm";
import fs from "node:fs";
import * as schema from "../db/schema";
import { resolveApprovals, checkFullyApproved, rejectRequisition } from "../db/approvals";
import { issuePurchaseOrder } from "../db/po";
import { recordGoodsReceipt } from "../db/fulfillment";
import { matchInvoice } from "../db/invoiceMatch";
import { logAction } from "../db/audit";

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k: string) => env.match(new RegExp(`${k}="?([^"\\n]+)"?`))?.[1];
const url = get("DATABASE_URL_MIGRATIONS");
if (!url) throw new Error("DATABASE_URL_MIGRATIONS not found in .env.local");

const client = postgres(url, { prepare: false });
const db = drizzle(client, { schema });

const TENANT_ID = "460f25af-36fc-42e9-944b-a285eac94ceb"; // AWA Demo Co

async function main() {
  const [vinit] = await db.select().from(schema.users).where(eq(schema.users.email, "vinit@chordia.co"));
  const [krunal] = await db.select().from(schema.users).where(eq(schema.users.email, "dangi.krunal@gmail.com"));
  const [opsDept] = await db.select().from(schema.departments).where(eq(schema.departments.tenantId, TENANT_ID));
  const [opsCC] = await db.select().from(schema.costCenters).where(eq(schema.costCenters.tenantId, TENANT_ID));

  console.log("Requestor pool:", vinit.fullName, krunal.fullName);

  // ---- Categories -------------------------------------------------------
  const categoryNames = ["IT Equipment", "Office Supplies", "Industrial Parts", "Professional Services"];
  const categories: Record<string, string> = {};
  for (const name of categoryNames) {
    const [existing] = await db.select().from(schema.catalogCategories).where(and(eq(schema.catalogCategories.tenantId, TENANT_ID), eq(schema.catalogCategories.name, name)));
    if (existing) { categories[name] = existing.id; continue; }
    const [created] = await db.insert(schema.catalogCategories).values({ tenantId: TENANT_ID, name }).returning();
    categories[name] = created.id;
  }
  console.log("Categories ready:", Object.keys(categories).join(", "));

  // ---- Departments & cost centers ----------------------------------------
  const [itDept] = await db.insert(schema.departments).values({ tenantId: TENANT_ID, name: "Information Technology", defaultCostCenterId: null }).returning();
  const [financeDept] = await db.insert(schema.departments).values({ tenantId: TENANT_ID, name: "Finance", defaultCostCenterId: null }).returning();
  const [itCC] = await db.insert(schema.costCenters).values({ tenantId: TENANT_ID, name: "IT-01", code: "IT-01", currency: "INR", annualBudget: "800000.00" }).returning();
  const [financeCC] = await db.insert(schema.costCenters).values({ tenantId: TENANT_ID, name: "Fin-01", code: "FIN-01", currency: "INR", annualBudget: "300000.00" }).returning();
  console.log("Departments/cost centers ready");

  // ---- Catalog items ------------------------------------------------------
  const itemDefs: Array<{ name: string; category: string; uom: string; price: number }> = [
    { name: "Laptop — 14in business", category: "IT Equipment", uom: "each", price: 68000 },
    { name: "27in Monitor", category: "IT Equipment", uom: "each", price: 14500 },
    { name: "Wireless Mouse", category: "IT Equipment", uom: "each", price: 850 },
    { name: "A4 Copier Paper (Ream)", category: "Office Supplies", uom: "ream", price: 320 },
    { name: "Ergonomic Office Chair", category: "Office Supplies", uom: "each", price: 9200 },
    { name: "Whiteboard Markers (Pack of 12)", category: "Office Supplies", uom: "pack", price: 480 },
    { name: "Industrial Gearbox 5HP", category: "Industrial Parts", uom: "each", price: 42000 },
    { name: "Hydraulic Hose 10m", category: "Industrial Parts", uom: "each", price: 3200 },
    { name: "Annual IT Support Contract", category: "Professional Services", uom: "each", price: 240000 },
    { name: "Office Deep Cleaning Service", category: "Professional Services", uom: "each", price: 18000 },
  ];
  const items: Record<string, { id: string; uom: string; price: number; categoryId: string }> = {};
  for (const def of itemDefs) {
    const [existing] = await db.select().from(schema.catalogItems).where(and(eq(schema.catalogItems.tenantId, TENANT_ID), eq(schema.catalogItems.name, def.name)));
    if (existing) { items[def.name] = { id: existing.id, uom: def.uom, price: def.price, categoryId: categories[def.category] }; continue; }
    const [created] = await db.insert(schema.catalogItems).values({
      tenantId: TENANT_ID, name: def.name, categoryId: categories[def.category], uom: def.uom, status: "verified", createdBy: vinit.id,
    }).returning();
    items[def.name] = { id: created.id, uom: def.uom, price: def.price, categoryId: categories[def.category] };
  }
  console.log("Catalog items ready:", Object.keys(items).length);

  // ---- Vendors --------------------------------------------------------
  await db.update(schema.vendors).set({ status: "active" }).where(and(eq(schema.vendors.tenantId, TENANT_ID), eq(schema.vendors.status, "pending")));
  const vendorDefs = ["Bright Office Supplies Co", "TechNova Systems Pvt Ltd", "Reliable Industrial Traders"];
  const vendorIds: Record<string, string> = {};
  for (const name of vendorDefs) {
    const [existing] = await db.select().from(schema.vendors).where(and(eq(schema.vendors.tenantId, TENANT_ID), eq(schema.vendors.name, name)));
    if (existing) { vendorIds[name] = existing.id; continue; }
    const [created] = await db.insert(schema.vendors).values({ tenantId: TENANT_ID, name, status: "active" }).returning();
    vendorIds[name] = created.id;
    const [contact] = await db.insert(schema.vendorUsers).values({
      tenantId: TENANT_ID, vendorId: created.id, email: `contact@${name.toLowerCase().replace(/[^a-z]+/g, "")}.example`, fullName: `${name} Contact`, status: "active",
    }).returning();
    void contact;
  }
  const allVendors = await db.select().from(schema.vendors).where(eq(schema.vendors.tenantId, TENANT_ID));
  console.log("Vendors ready:", allVendors.map((v) => `${v.name} (${v.status})`).join(", "));

  // ---- Helpers ------------------------------------------------------------
  type LineSpec = { item: keyof typeof items; qty: number };

  async function createRequisitionRows(requestorId: string, deptId: string, ccId: string, justification: string, lines: LineSpec[]) {
    const linesWithTotals = lines.map((l) => {
      const item = items[l.item as string];
      const lineTotal = (item.price * l.qty).toFixed(2);
      return { catalogItemId: item.id, freeTextDescription: null as string | null, categoryId: item.categoryId, fulfillmentType: "goods" as const, quantity: String(l.qty), uom: item.uom, estimatedUnitPrice: item.price.toFixed(2), lineTotal };
    });
    const total = linesWithTotals.reduce((s, l) => s + Number(l.lineTotal), 0).toFixed(2);
    const [req] = await db.insert(schema.purchaseRequisitions).values({
      tenantId: TENANT_ID, requestorId, departmentId: deptId, costCenterId: ccId, justification, totalEstimatedValue: total, status: "draft",
    }).returning();
    await db.insert(schema.purchaseRequisitionLines).values(linesWithTotals.map((l) => ({ tenantId: TENANT_ID, requisitionId: req.id, ...l })));
    return req;
  }

  async function submitRequisition(reqId: string) {
    await db.update(schema.purchaseRequisitions).set({ status: "submitted", submittedAt: new Date() }).where(eq(schema.purchaseRequisitions.id, reqId));
    await resolveApprovals(db, TENANT_ID, reqId);
  }

  async function approveAsWhoeverIsAssigned(reqId: string) {
    let guard = 0;
    while (guard++ < 5) {
      const pending = await db.select().from(schema.requisitionApprovalRequirements).where(and(eq(schema.requisitionApprovalRequirements.requisitionId, reqId), eq(schema.requisitionApprovalRequirements.status, "pending")));
      if (pending.length === 0) break;
      const minGroup = Math.min(...pending.map((p) => p.groupNo));
      for (const req of pending.filter((p) => p.groupNo === minGroup)) {
        await db.update(schema.requisitionApprovalRequirements).set({ status: "approved", decidedAt: new Date() }).where(eq(schema.requisitionApprovalRequirements.id, req.id));
        await db.insert(schema.approvalDecisionLog).values({ tenantId: TENANT_ID, requisitionApprovalRequirementId: req.id, actorUserId: req.assignedUserId, action: "approved" });
      }
      await checkFullyApproved(db, TENANT_ID, reqId);
    }
  }

  async function sourceAndIssuePO(reqId: string, vendorId: string, quotedTotal: string, actorId: string) {
    const [rfq] = await db.insert(schema.rfqs).values({ tenantId: TENANT_ID, requisitionId: reqId }).returning();
    await db.insert(schema.rfqVendorInvitations).values({ tenantId: TENANT_ID, rfqId: rfq.id, vendorId, status: "quoted" });
    const [quote] = await db.insert(schema.vendorQuotations).values({ tenantId: TENANT_ID, rfqId: rfq.id, vendorId, totalAmount: quotedTotal, currency: "INR", status: "submitted" }).returning();
    const result = await issuePurchaseOrder(db, TENANT_ID, actorId, reqId, vendorId, quote.id);
    if (result.error) throw new Error(`issuePurchaseOrder failed: ${result.error}`);
    return result.poId!;
  }

  async function receiveAllGoods(poId: string, receiverId: string, fraction = 1) {
    const lines = await db.select().from(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.poId, poId));
    const inputs = lines.map((l) => {
      const qty = (Number(l.quantity) * fraction).toFixed(3);
      return { poLineId: l.id, quantityDelivered: qty, quantityAccepted: qty, quantityRejected: "0", condition: "good" as const, rejectionReason: null };
    });
    const result = await recordGoodsReceipt(db, TENANT_ID, receiverId, poId, receiverId, "DN-" + Math.random().toString(36).slice(2, 8).toUpperCase(), inputs);
    if (result.error) throw new Error(`recordGoodsReceipt failed: ${result.error}`);
  }

  async function submitInvoice(poId: string, vendorId: string, invoiceNumber: string, amountOverride?: string, skipMatch = false) {
    const poLines = await db.select().from(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.poId, poId));
    const total = amountOverride ?? poLines.reduce((s, l) => s + Number(l.lineTotal), 0).toFixed(2);
    const [invoice] = await db.insert(schema.invoices).values({
      tenantId: TENANT_ID, vendorId, poId, invoiceNumber, invoiceDate: new Date().toISOString().slice(0, 10), totalAmount: total, currency: "INR",
    }).returning();
    const scale = amountOverride ? Number(amountOverride) / poLines.reduce((s, l) => s + Number(l.lineTotal), 0) : 1;
    await db.insert(schema.invoiceLines).values(poLines.map((l) => ({
      tenantId: TENANT_ID, invoiceId: invoice.id, poLineId: l.id, quantity: l.quantity, unitPrice: (Number(l.unitPrice) * scale).toFixed(2), lineTotal: (Number(l.lineTotal) * scale).toFixed(2),
    })));
    if (!skipMatch) await matchInvoice(db, TENANT_ID, invoice.id);
    return invoice.id;
  }

  async function approveInvoiceForPayment(invoiceId: string) {
    const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId));
    await db.update(schema.invoices).set({ status: "approved_for_payment" }).where(eq(schema.invoices.id, invoiceId));
    const [payment] = await db.insert(schema.paymentInstructions).values({ tenantId: TENANT_ID, invoiceId, amount: invoice.totalAmount, currency: invoice.currency }).returning();
    return payment.id;
  }

  async function releaseThePayment(paymentId: string, releasedBy: string) {
    const [payment] = await db.select().from(schema.paymentInstructions).where(eq(schema.paymentInstructions.id, paymentId));
    await db.update(schema.paymentInstructions).set({ status: "released", releasedBy, releasedAt: new Date() }).where(eq(schema.paymentInstructions.id, paymentId));
    await db.update(schema.invoices).set({ status: "paid" }).where(eq(schema.invoices.id, payment.invoiceId));
  }

  const acme = allVendors.find((v) => v.name === "Acme Industrial Supplies")!.id;
  const bright = vendorIds["Bright Office Supplies Co"];
  const technova = vendorIds["TechNova Systems Pvt Ltd"];
  const reliable = vendorIds["Reliable Industrial Traders"];

  // ---- Scenarios ------------------------------------------------------
  console.log("\nSeeding requisitions across the full lifecycle spectrum...");

  // 1-2: Draft
  await createRequisitionRows(vinit.id, itDept.id, itCC.id, "New joiner laptop + monitor", [{ item: "Laptop — 14in business", qty: 1 }, { item: "27in Monitor", qty: 1 }]);
  await createRequisitionRows(krunal.id, financeDept.id, financeCC.id, "Office chairs for finance team", [{ item: "Ergonomic Office Chair", qty: 4 }]);
  console.log("  ✓ 2 drafts");

  // 3: Pending approval
  {
    const r = await createRequisitionRows(vinit.id, itDept.id, itCC.id, "Wireless mice for the team", [{ item: "Wireless Mouse", qty: 10 }]);
    await submitRequisition(r.id);
    console.log("  ✓ pending approval");
  }

  // 4: Rejected — needs revision
  {
    const r = await createRequisitionRows(krunal.id, opsDept.id, opsCC.id, "Copier paper bulk order", [{ item: "A4 Copier Paper (Ream)", qty: 50 }]);
    await submitRequisition(r.id);
    const [reqt] = await db.select().from(schema.requisitionApprovalRequirements).where(and(eq(schema.requisitionApprovalRequirements.requisitionId, r.id), eq(schema.requisitionApprovalRequirements.status, "pending")));
    if (reqt) await rejectRequisition(db, TENANT_ID, reqt.assignedUserId, reqt.id, "revisable", "Quantity seems too high for one quarter — please confirm with facilities.");
    console.log("  ✓ rejected (revisable)");
  }

  // 5: Rejected — closed
  {
    const r = await createRequisitionRows(vinit.id, financeDept.id, financeCC.id, "Speculative gearbox purchase", [{ item: "Industrial Gearbox 5HP", qty: 2 }]);
    await submitRequisition(r.id);
    const [reqt] = await db.select().from(schema.requisitionApprovalRequirements).where(and(eq(schema.requisitionApprovalRequirements.requisitionId, r.id), eq(schema.requisitionApprovalRequirements.status, "pending")));
    if (reqt) await rejectRequisition(db, TENANT_ID, reqt.assignedUserId, reqt.id, "closed", "Not aligned with this quarter's budget — resubmit next quarter if still needed.");
    console.log("  ✓ rejected (closed)");
  }

  // 6: Cancelled (direct status set — no dedicated action exists yet)
  {
    const r = await createRequisitionRows(krunal.id, itDept.id, itCC.id, "Extra monitors — project cancelled", [{ item: "27in Monitor", qty: 3 }]);
    await db.update(schema.purchaseRequisitions).set({ status: "cancelled" }).where(eq(schema.purchaseRequisitions.id, r.id));
    console.log("  ✓ cancelled");
  }

  // 7: Approved — awaiting sourcing
  {
    const r = await createRequisitionRows(vinit.id, itDept.id, itCC.id, "Annual IT support renewal", [{ item: "Annual IT Support Contract", qty: 1 }]);
    await submitRequisition(r.id);
    await approveAsWhoeverIsAssigned(r.id);
    console.log("  ✓ approved — awaiting sourcing");
  }

  // 8: Sourcing (RFQ open, vendor invited, no quote yet)
  {
    const r = await createRequisitionRows(krunal.id, opsDept.id, opsCC.id, "Deep cleaning before audit", [{ item: "Office Deep Cleaning Service", qty: 1 }]);
    await submitRequisition(r.id);
    await approveAsWhoeverIsAssigned(r.id);
    const [rfq] = await db.insert(schema.rfqs).values({ tenantId: TENANT_ID, requisitionId: r.id }).returning();
    await db.insert(schema.rfqVendorInvitations).values({ tenantId: TENANT_ID, rfqId: rfq.id, vendorId: reliable, status: "invited" });
    console.log("  ✓ sourcing (awaiting quote)");
  }

  // 9: PO issued — awaiting fulfillment
  {
    const r = await createRequisitionRows(vinit.id, opsDept.id, opsCC.id, "Hydraulic hoses for line 2", [{ item: "Hydraulic Hose 10m", qty: 8 }]);
    await submitRequisition(r.id);
    await approveAsWhoeverIsAssigned(r.id);
    const total = (Number(items["Hydraulic Hose 10m"].price) * 8 * 0.94).toFixed(2);
    await sourceAndIssuePO(r.id, reliable, total, krunal.id);
    console.log("  ✓ PO issued — awaiting fulfillment");
  }

  // 10: Partially fulfilled
  {
    const r = await createRequisitionRows(krunal.id, itDept.id, itCC.id, "Laptops for new hires (batch 2)", [{ item: "Laptop — 14in business", qty: 4 }]);
    await submitRequisition(r.id);
    await approveAsWhoeverIsAssigned(r.id);
    const total = (Number(items["Laptop — 14in business"].price) * 4 * 0.97).toFixed(2);
    const poId = await sourceAndIssuePO(r.id, technova, total, vinit.id);
    await receiveAllGoods(poId, vinit.id, 0.5);
    console.log("  ✓ partially fulfilled");
  }

  // 11: Fulfilled — awaiting invoice
  {
    const r = await createRequisitionRows(vinit.id, itDept.id, itCC.id, "Standard-issue mice restock", [{ item: "Wireless Mouse", qty: 25 }]);
    await submitRequisition(r.id);
    await approveAsWhoeverIsAssigned(r.id);
    const total = (Number(items["Wireless Mouse"].price) * 25 * 0.9).toFixed(2);
    const poId = await sourceAndIssuePO(r.id, technova, total, krunal.id);
    await receiveAllGoods(poId, krunal.id);
    console.log("  ✓ fulfilled — awaiting invoice");
  }

  // 12: Invoice submitted (unmatched — demo of the transient pre-match state)
  {
    const r = await createRequisitionRows(krunal.id, opsDept.id, opsCC.id, "Whiteboard markers restock", [{ item: "Whiteboard Markers (Pack of 12)", qty: 15 }]);
    await submitRequisition(r.id);
    await approveAsWhoeverIsAssigned(r.id);
    const total = (Number(items["Whiteboard Markers (Pack of 12)"].price) * 15).toFixed(2);
    const poId = await sourceAndIssuePO(r.id, bright, total, vinit.id);
    await receiveAllGoods(poId, vinit.id);
    await submitInvoice(poId, bright, "BOS-" + Math.random().toString(36).slice(2, 7).toUpperCase(), undefined, /* skipMatch */ true);
    console.log("  ✓ invoice submitted (unmatched)");
  }

  // 13: Invoice matched — awaiting payment approval
  {
    const r = await createRequisitionRows(vinit.id, financeDept.id, financeCC.id, "Office chairs — finance annex", [{ item: "Ergonomic Office Chair", qty: 6 }]);
    await submitRequisition(r.id);
    await approveAsWhoeverIsAssigned(r.id);
    const total = (Number(items["Ergonomic Office Chair"].price) * 6 * 0.95).toFixed(2);
    const poId = await sourceAndIssuePO(r.id, bright, total, krunal.id);
    await receiveAllGoods(poId, krunal.id);
    await submitInvoice(poId, bright, "BOS-" + Math.random().toString(36).slice(2, 7).toUpperCase());
    console.log("  ✓ invoice matched — awaiting payment approval");
  }

  // 14: Invoice exception — needs review
  {
    const r = await createRequisitionRows(krunal.id, opsDept.id, opsCC.id, "Gearbox replacement — line 3", [{ item: "Industrial Gearbox 5HP", qty: 1 }]);
    await submitRequisition(r.id);
    await approveAsWhoeverIsAssigned(r.id);
    const total = (Number(items["Industrial Gearbox 5HP"].price) * 0.9).toFixed(2);
    const poId = await sourceAndIssuePO(r.id, acme, total, vinit.id);
    await receiveAllGoods(poId, vinit.id);
    // Invoice for a materially different amount than the PO — forces a genuine matching exception.
    const badAmount = (Number(total) * 1.3).toFixed(2);
    await submitInvoice(poId, acme, "ACME-EXC-" + Math.random().toString(36).slice(2, 6).toUpperCase(), badAmount);
    console.log("  ✓ invoice exception — needs review");
  }

  // 15: Invoice disputed
  {
    const r = await createRequisitionRows(vinit.id, opsDept.id, opsCC.id, "Hydraulic hose — emergency replacement", [{ item: "Hydraulic Hose 10m", qty: 3 }]);
    await submitRequisition(r.id);
    await approveAsWhoeverIsAssigned(r.id);
    const total = (Number(items["Hydraulic Hose 10m"].price) * 3).toFixed(2);
    const poId = await sourceAndIssuePO(r.id, reliable, total, krunal.id);
    await receiveAllGoods(poId, krunal.id);
    const invoiceId = await submitInvoice(poId, reliable, "REL-" + Math.random().toString(36).slice(2, 7).toUpperCase());
    await db.update(schema.invoices).set({ status: "disputed" }).where(eq(schema.invoices.id, invoiceId));
    await logAction(db, { tenantId: TENANT_ID, actorUserId: vinit.id, action: "invoice.disputed", entityType: "invoice", entityId: invoiceId, metadata: { reason: "Vendor billed for a 15m hose; PO was for 10m." } });
    console.log("  ✓ invoice disputed");
  }

  // 16: Payment queued (approved for payment, not yet released)
  {
    const r = await createRequisitionRows(krunal.id, itDept.id, itCC.id, "27in monitors for design team", [{ item: "27in Monitor", qty: 5 }]);
    await submitRequisition(r.id);
    await approveAsWhoeverIsAssigned(r.id);
    const total = (Number(items["27in Monitor"].price) * 5 * 0.96).toFixed(2);
    const poId = await sourceAndIssuePO(r.id, technova, total, vinit.id);
    await receiveAllGoods(poId, vinit.id);
    const invoiceId = await submitInvoice(poId, technova, "TN-" + Math.random().toString(36).slice(2, 7).toUpperCase());
    await approveInvoiceForPayment(invoiceId);
    console.log("  ✓ payment queued");
  }

  // 17: Paid — the full happy path, start to finish
  {
    const r = await createRequisitionRows(vinit.id, opsDept.id, opsCC.id, "Replacement gearbox — routine maintenance", [{ item: "Industrial Gearbox 5HP", qty: 1 }]);
    await submitRequisition(r.id);
    await approveAsWhoeverIsAssigned(r.id);
    const total = (Number(items["Industrial Gearbox 5HP"].price) * 0.93).toFixed(2);
    const poId = await sourceAndIssuePO(r.id, acme, total, krunal.id);
    await receiveAllGoods(poId, krunal.id);
    const invoiceId = await submitInvoice(poId, acme, "ACME-PAID-" + Math.random().toString(36).slice(2, 6).toUpperCase());
    const paymentId = await approveInvoiceForPayment(invoiceId);
    await releaseThePayment(paymentId, vinit.id);
    console.log("  ✓ paid (full lifecycle)");
  }

  console.log("\nDone.");
  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
