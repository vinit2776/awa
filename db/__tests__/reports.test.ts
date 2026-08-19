import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { db } from "../client";
import { adminDb } from "../adminClient";
import { withTenant } from "../withTenant";
import { resolveApprovals } from "../approvals";
import { getApprovalsReport } from "../reports";
import {
  tenants,
  users,
  departments,
  costCenters,
  purchaseRequisitions,
  purchaseRequisitionLines,
  requisitionApprovalRequirements,
  auditLog,
} from "../schema";

/**
 * Uses resolveApprovals with no matching approval rule (the simplest
 * reliable way to produce a real "requisition.auto_approved" audit_log
 * row, the same event source getApprovalsReport reads) rather than
 * standing up a full rule + role + approve-click flow neither of which
 * this report cares about.
 */

// tenants.slug is globally unique, so a fixed slug collides outright with a
// concurrent run on the shared dev database. Same per-run suffix every other
// suite in this directory uses.
const suffix = crypto.randomUUID().slice(0, 8);

let tenant: typeof tenants.$inferSelect;
let requestor: typeof users.$inferSelect;
let deptA: typeof departments.$inferSelect;
let deptB: typeof departments.$inferSelect;
let cc: typeof costCenters.$inferSelect;

beforeAll(async () => {
  [tenant] = await adminDb.insert(tenants).values({ name: "Reports Co", slug: `reports-co-${suffix}` }).returning();
  [requestor] = await adminDb.insert(users).values({ tenantId: tenant.id, email: "reports-requestor@example.com", fullName: "Reba Requestor", status: "active" }).returning();
  await withTenant(tenant.id, async (tx) => {
    [deptA] = await tx.insert(departments).values({ tenantId: tenant.id, name: "Reports Dept A" }).returning();
    [deptB] = await tx.insert(departments).values({ tenantId: tenant.id, name: "Reports Dept B" }).returning();
    // resolveApprovals's rule-matching query treats a null cost_center_id
    // as an empty-string uuid param rather than a null comparison, which
    // Postgres rejects — every other test that calls it works around the
    // same thing by always giving the requisition a real cost center.
    [cc] = await tx.insert(costCenters).values({ tenantId: tenant.id, name: "Reports CC", code: "REPORTS-CC" }).returning();
  });
});

afterAll(async () => {
  const tables = [
    auditLog, requisitionApprovalRequirements, purchaseRequisitionLines, purchaseRequisitions,
    costCenters, departments, users,
  ];
  for (const table of tables) {
    await adminDb.delete(table).where(sql`tenant_id = ${tenant.id}`);
  }
  await adminDb.delete(tenants).where(eq(tenants.id, tenant.id));
});

async function submitAndAutoApprove(tx: typeof db, departmentId: string, value: string) {
  const [requisition] = await tx
    .insert(purchaseRequisitions)
    .values({ tenantId: tenant.id, requestorId: requestor.id, departmentId, costCenterId: cc.id, status: "draft", totalEstimatedValue: "0" })
    .returning();
  await tx.insert(purchaseRequisitionLines).values({
    tenantId: tenant.id, requisitionId: requisition.id, freeTextDescription: "Report item",
    fulfillmentType: "goods", quantity: "1", uom: "each", estimatedUnitPrice: value, lineTotal: value,
  });
  await tx.update(purchaseRequisitions).set({ status: "submitted", submittedAt: new Date(), totalEstimatedValue: value }).where(eq(purchaseRequisitions.id, requisition.id));
  await resolveApprovals(tx, tenant.id, requisition.id); // no matching rule -> auto-approved
  return requisition;
}

describe("getApprovalsReport", () => {
  it("totals value and count across departments, and buckets by department", async () => {
    await withTenant(tenant.id, async (tx) => {
      await submitAndAutoApprove(tx, deptA.id, "1000");
      await submitAndAutoApprove(tx, deptA.id, "500");
      await submitAndAutoApprove(tx, deptB.id, "250");

      const report = await getApprovalsReport(tx);

      expect(report.totalValue).toBeGreaterThanOrEqual(1750);
      expect(report.totalCount).toBeGreaterThanOrEqual(3);

      const a = report.byDepartment.find((d) => d.departmentId === deptA.id);
      const b = report.byDepartment.find((d) => d.departmentId === deptB.id);
      expect(a?.value).toBe(1500);
      expect(a?.count).toBe(2);
      expect(b?.value).toBe(250);
      expect(b?.count).toBe(1);

      const monthTotal = report.timeline.reduce((sum, r) => sum + r.value, 0);
      expect(monthTotal).toBe(report.totalValue);
    });
  });

  it("returns an empty report for a tenant with no approved requisitions", async () => {
    const [emptyTenant] = await adminDb.insert(tenants).values({ name: "Empty Reports Co", slug: `empty-reports-co-${suffix}` }).returning();
    try {
      const report = await withTenant(emptyTenant.id, (tx) => getApprovalsReport(tx));
      expect(report.totalValue).toBe(0);
      expect(report.totalCount).toBe(0);
      expect(report.timeline).toEqual([]);
      expect(report.byDepartment).toEqual([]);
    } finally {
      await adminDb.delete(tenants).where(eq(tenants.id, emptyTenant.id));
    }
  });
});
