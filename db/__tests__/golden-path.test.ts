import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "../adminClient";
import { withTenant } from "../withTenant";
import { resolveApprovals, checkFullyApproved } from "../approvals";
import { issuePurchaseOrder } from "../po";
import { recordGoodsReceipt } from "../fulfillment";
import { matchInvoice } from "../invoiceMatch";
import {
  tenants,
  users,
  roles,
  userRoles,
  departments,
  costCenters,
  vendors,
  approvalRules,
  approvalRuleRequirements,
  purchaseRequisitions,
  purchaseRequisitionLines,
  requisitionApprovalRequirements,
  rfqs,
  rfqVendorInvitations,
  vendorQuotations,
  purchaseOrders,
  purchaseOrderLines,
  goodsReceiptLines,
  goodsReceiptNotes,
  invoices,
  invoiceLines,
  invoiceLineMatches,
  paymentInstructions,
  auditLog,
} from "../schema";

/**
 * Walks one requisition through every stage of phase 1 in a single
 * connected test — draft, submit, approve, RFQ, quotation, PO issuance,
 * goods receipt, invoice, 3-way match, payment release — calling the
 * same db/*.ts functions the real server actions call, not
 * reimplemented logic. This is an integration test through the
 * business-logic layer, not a browser-driven e2e: there's no way to
 * automate a real WorkOS sign-in session without either a live test
 * org or an auth-bypass path, and adding an auth bypass isn't something
 * to do without being asked. If browser-level e2e is wanted later, that
 * needs a deliberate decision about test-auth infrastructure first.
 */

let tenant: typeof tenants.$inferSelect;
let requestor: typeof users.$inferSelect;
let approver: typeof users.$inferSelect;
let receiver: typeof users.$inferSelect;

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  [tenant] = await adminDb.insert(tenants).values({ name: "Golden Path Co", slug: `golden-path-co-${suffix}` }).returning();
  [requestor] = await adminDb.insert(users).values({ tenantId: tenant.id, email: "gp-requestor@example.com", fullName: "Rachel Requestor", status: "active" }).returning();
  [approver] = await adminDb.insert(users).values({ tenantId: tenant.id, email: "gp-approver@example.com", fullName: "Dave Director", status: "active" }).returning();
  [receiver] = await adminDb.insert(users).values({ tenantId: tenant.id, email: "gp-receiver@example.com", fullName: "Ravi Receiver", status: "active" }).returning();
});

afterAll(async () => {
  const tables = [
    auditLog, paymentInstructions, invoiceLineMatches, invoiceLines, invoices,
    goodsReceiptLines, goodsReceiptNotes, purchaseOrderLines, purchaseOrders,
    vendorQuotations, rfqVendorInvitations, rfqs,
    requisitionApprovalRequirements, purchaseRequisitionLines, purchaseRequisitions,
    approvalRuleRequirements, approvalRules, userRoles, roles,
    costCenters, departments, vendors, users,
  ];
  for (const table of tables) {
    await adminDb.delete(table).where(sql`tenant_id = ${tenant.id}`);
  }
  await adminDb.delete(tenants).where(eq(tenants.id, tenant.id));
});

describe("golden path: requisition through payment", () => {
  it("completes every stage in order", async () => {
    await withTenant(tenant.id, async (tx) => {
      const [directorRole] = await tx.insert(roles).values({ tenantId: tenant.id, key: "director", displayName: "Director" }).returning();
      await tx.insert(userRoles).values({ tenantId: tenant.id, userId: approver.id, roleId: directorRole.id, scopeType: "global" });

      const [dept] = await tx.insert(departments).values({ tenantId: tenant.id, name: "Ops" }).returning();
      const [cc] = await tx.insert(costCenters).values({ tenantId: tenant.id, name: "Ops-01", code: "OPS-GP" }).returning();
      const [vendor] = await tx.insert(vendors).values({ tenantId: tenant.id, name: "Golden Vendor", status: "active" }).returning();

      const [rule] = await tx.insert(approvalRules).values({ tenantId: tenant.id, name: "All goods", minValue: "0", maxValue: null }).returning();
      await tx.insert(approvalRuleRequirements).values({ tenantId: tenant.id, ruleId: rule.id, approverRoleId: directorRole.id, groupNo: 1, groupSequence: 1, minApprovalsInGroup: 1 });

      // 1. Draft -> submit
      const [requisition] = await tx
        .insert(purchaseRequisitions)
        .values({ tenantId: tenant.id, requestorId: requestor.id, departmentId: dept.id, costCenterId: cc.id, status: "draft", totalEstimatedValue: "0" })
        .returning();
      await tx.insert(purchaseRequisitionLines).values({
        tenantId: tenant.id, requisitionId: requisition.id, freeTextDescription: "Ball valve",
        fulfillmentType: "goods", quantity: "10", uom: "each", estimatedUnitPrice: "100", lineTotal: "1000",
      });
      await tx.update(purchaseRequisitions).set({ status: "submitted", submittedAt: new Date(), totalEstimatedValue: "1000" }).where(eq(purchaseRequisitions.id, requisition.id));

      // 2. Rule resolution -> pending_approval
      await resolveApprovals(tx, tenant.id, requisition.id);
      const [afterResolve] = await tx.select().from(purchaseRequisitions).where(eq(purchaseRequisitions.id, requisition.id));
      expect(afterResolve.status).toBe("pending_approval");

      // 3. Approve -> approved
      const [requirement] = await tx
        .select()
        .from(requisitionApprovalRequirements)
        .where(and(eq(requisitionApprovalRequirements.requisitionId, requisition.id), eq(requisitionApprovalRequirements.assignedUserId, approver.id)));
      expect(requirement).toBeDefined();
      await tx.update(requisitionApprovalRequirements).set({ status: "approved", decidedAt: new Date() }).where(eq(requisitionApprovalRequirements.id, requirement.id));

      await checkFullyApproved(tx, tenant.id, requisition.id);
      const [afterApproval] = await tx.select().from(purchaseRequisitions).where(eq(purchaseRequisitions.id, requisition.id));
      expect(afterApproval.status).toBe("approved");

      // 4. RFQ -> invite -> quote -> issue PO
      const [rfq] = await tx.insert(rfqs).values({ tenantId: tenant.id, requisitionId: requisition.id }).returning();
      await tx.insert(rfqVendorInvitations).values({ tenantId: tenant.id, rfqId: rfq.id, vendorId: vendor.id });
      const [quotation] = await tx.insert(vendorQuotations).values({ tenantId: tenant.id, rfqId: rfq.id, vendorId: vendor.id, totalAmount: "1000" }).returning();

      const issueResult = await issuePurchaseOrder(tx, tenant.id, approver.id, requisition.id, vendor.id, quotation.id);
      expect(issueResult.error).toBeUndefined();
      expect(issueResult.poId).toBeDefined();

      const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, issueResult.poId!));
      expect(po.status).toBe("issued");
      expect(po.totalAmount).toBe("1000.00");

      const [afterPo] = await tx.select().from(purchaseRequisitions).where(eq(purchaseRequisitions.id, requisition.id));
      expect(afterPo.status).toBe("converted_to_po");

      // 5. Goods receipt -> PO fulfilled
      const [poLine] = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, po.id));
      const receiptResult = await recordGoodsReceipt(tx, tenant.id, approver.id, po.id, receiver.id, "DN-GP-001", [
        { poLineId: poLine.id, quantityDelivered: "10", quantityAccepted: "10", quantityRejected: "0", condition: "good", rejectionReason: null },
      ]);
      expect(receiptResult.error).toBeUndefined();

      const [poAfterReceipt] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id));
      expect(poAfterReceipt.status).toBe("fulfilled");

      // 6. Invoice -> exact 3-way match -> matched
      const [invoice] = await tx
        .insert(invoices)
        .values({ tenantId: tenant.id, vendorId: vendor.id, poId: po.id, invoiceNumber: "INV-GP-001", invoiceDate: "2026-01-01", totalAmount: "1000" })
        .returning();
      await tx.insert(invoiceLines).values({ tenantId: tenant.id, invoiceId: invoice.id, poLineId: poLine.id, quantity: "10", unitPrice: "100", lineTotal: "1000" });

      const matchResult = await matchInvoice(tx, tenant.id, invoice.id);
      expect(matchResult.status).toBe("matched");

      // 7. Payment queue -> release -> paid
      await tx.update(invoices).set({ status: "approved_for_payment" }).where(eq(invoices.id, invoice.id));
      const [payment] = await tx.insert(paymentInstructions).values({ tenantId: tenant.id, invoiceId: invoice.id, amount: invoice.totalAmount }).returning();
      expect(payment.status).toBe("queued");

      await tx.update(paymentInstructions).set({ status: "released", releasedBy: approver.id, releasedAt: new Date() }).where(eq(paymentInstructions.id, payment.id));
      await tx.update(invoices).set({ status: "paid" }).where(eq(invoices.id, invoice.id));

      const [finalInvoice] = await tx.select().from(invoices).where(eq(invoices.id, invoice.id));
      const [finalPayment] = await tx.select().from(paymentInstructions).where(eq(paymentInstructions.id, payment.id));
      expect(finalInvoice.status).toBe("paid");
      expect(finalPayment.status).toBe("released");
    });
  });
});
