import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { db } from "../client";
import { adminDb } from "../adminClient";
import { withTenant } from "../withTenant";
import { resolveApprovals, addAdHocApprover } from "../approvals";
import {
  tenants,
  users,
  roles,
  userRoles,
  departments,
  costCenters,
  approvalRules,
  approvalRuleRequirements,
  purchaseRequisitions,
  purchaseRequisitionLines,
  requisitionApprovalRequirements,
  auditLog,
} from "../schema";

/**
 * §02 segregation of duties: a requestor can never end up as an
 * approver on their own requisition, through either door into
 * requisition_approval_requirements — rule resolution (resolveApprovals)
 * or an ad-hoc addition (addAdHocApprover). Found live: the requestor
 * held the only role that matched their own request's approval rule,
 * and resolveApprovals happily assigned them to approve themselves.
 */

let tenant: typeof tenants.$inferSelect;
let requestor: typeof users.$inferSelect;
let otherApprover: typeof users.$inferSelect;

beforeAll(async () => {
  [tenant] = await adminDb.insert(tenants).values({ name: "SoD Co", slug: "sod-co" }).returning();
  [requestor] = await adminDb.insert(users).values({ tenantId: tenant.id, email: "sod-requestor@example.com", fullName: "Sam Requestor", status: "active" }).returning();
  [otherApprover] = await adminDb.insert(users).values({ tenantId: tenant.id, email: "sod-other@example.com", fullName: "Ana Other", status: "active" }).returning();
});

afterAll(async () => {
  const tables = [
    auditLog, requisitionApprovalRequirements, purchaseRequisitionLines, purchaseRequisitions,
    approvalRuleRequirements, approvalRules, userRoles, roles, costCenters, departments, users,
  ];
  for (const table of tables) {
    await adminDb.delete(table).where(sql`tenant_id = ${tenant.id}`);
  }
  await adminDb.delete(tenants).where(eq(tenants.id, tenant.id));
});

// Each test scopes its rule to its own freshly-created department (see
// below) — approvalRules with no department/cost-center set are tenant-
// wide wildcards, and every test in this file shares one tenant, so an
// unscoped rule from an earlier test would otherwise keep matching every
// later test's requisition too and stack extra approvers onto it.
async function createDeptAndCostCenter(tx: typeof db) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [dept] = await tx.insert(departments).values({ tenantId: tenant.id, name: `Dept-${suffix}` }).returning();
  const [cc] = await tx.insert(costCenters).values({ tenantId: tenant.id, name: `CC-${suffix}`, code: `SOD-${suffix}` }).returning();
  return { dept, cc };
}

async function createSubmittedRequisition(tx: typeof db, requestorId: string, departmentId: string, costCenterId: string) {
  const [requisition] = await tx
    .insert(purchaseRequisitions)
    .values({ tenantId: tenant.id, requestorId, departmentId, costCenterId, status: "draft", totalEstimatedValue: "0" })
    .returning();
  await tx.insert(purchaseRequisitionLines).values({
    tenantId: tenant.id, requisitionId: requisition.id, freeTextDescription: "Widget",
    fulfillmentType: "goods", quantity: "1", uom: "each", estimatedUnitPrice: "500", lineTotal: "500",
  });
  await tx.update(purchaseRequisitions).set({ status: "submitted", submittedAt: new Date(), totalEstimatedValue: "500" }).where(eq(purchaseRequisitions.id, requisition.id));
  return requisition;
}

describe("segregation of duties: approval engine", () => {
  it("never assigns the requestor as their own rule-based approver, even when they hold the qualifying role", async () => {
    await withTenant(tenant.id, async (tx) => {
      const [role] = await tx.insert(roles).values({ tenantId: tenant.id, key: "sod-approver", displayName: "SoD Approver" }).returning();
      // The requestor themself holds the approving role globally — the
      // exact live scenario: nothing else disqualified them.
      await tx.insert(userRoles).values({ tenantId: tenant.id, userId: requestor.id, roleId: role.id, scopeType: "global" });
      await tx.insert(userRoles).values({ tenantId: tenant.id, userId: otherApprover.id, roleId: role.id, scopeType: "global" });

      const { dept, cc } = await createDeptAndCostCenter(tx);
      const [rule] = await tx.insert(approvalRules).values({ tenantId: tenant.id, name: "SoD rule", minValue: "0", maxValue: null, departmentId: dept.id }).returning();
      await tx.insert(approvalRuleRequirements).values({ tenantId: tenant.id, ruleId: rule.id, approverRoleId: role.id, groupNo: 1, groupSequence: 1, minApprovalsInGroup: 1 });

      const requisition = await createSubmittedRequisition(tx, requestor.id, dept.id, cc.id);
      await resolveApprovals(tx, tenant.id, requisition.id);

      const assigned = await tx
        .select()
        .from(requisitionApprovalRequirements)
        .where(eq(requisitionApprovalRequirements.requisitionId, requisition.id));

      expect(assigned.some((r) => r.assignedUserId === requestor.id)).toBe(false);
      expect(assigned.some((r) => r.assignedUserId === otherApprover.id)).toBe(true);

      const [afterResolve] = await tx.select().from(purchaseRequisitions).where(eq(purchaseRequisitions.id, requisition.id));
      expect(afterResolve.status).toBe("pending_approval");
    });
  });

  it("falls into the existing zero-eligible-approvers auto-approve path when excluding the requestor leaves nobody", async () => {
    await withTenant(tenant.id, async (tx) => {
      const [role] = await tx.insert(roles).values({ tenantId: tenant.id, key: "sod-only-role", displayName: "SoD Only Role" }).returning();
      // Requestor is the *only* holder of the qualifying role — excluding
      // them for self-approval must drop to zero eligible, not error.
      await tx.insert(userRoles).values({ tenantId: tenant.id, userId: requestor.id, roleId: role.id, scopeType: "global" });

      const { dept, cc } = await createDeptAndCostCenter(tx);
      const [rule] = await tx.insert(approvalRules).values({ tenantId: tenant.id, name: "SoD solo rule", minValue: "0", maxValue: null, departmentId: dept.id }).returning();
      await tx.insert(approvalRuleRequirements).values({ tenantId: tenant.id, ruleId: rule.id, approverRoleId: role.id, groupNo: 1, groupSequence: 1, minApprovalsInGroup: 1 });

      const requisition = await createSubmittedRequisition(tx, requestor.id, dept.id, cc.id);
      await resolveApprovals(tx, tenant.id, requisition.id);

      const [afterResolve] = await tx.select().from(purchaseRequisitions).where(eq(purchaseRequisitions.id, requisition.id));
      expect(afterResolve.status).toBe("approved");
    });
  });

  it("refuses to add the requestor as an ad-hoc approver on their own requisition", async () => {
    await withTenant(tenant.id, async (tx) => {
      const [role] = await tx.insert(roles).values({ tenantId: tenant.id, key: "sod-adhoc-role", displayName: "SoD Ad Hoc Role" }).returning();
      await tx.insert(userRoles).values({ tenantId: tenant.id, userId: otherApprover.id, roleId: role.id, scopeType: "global" });

      const { dept, cc } = await createDeptAndCostCenter(tx);
      const [rule] = await tx.insert(approvalRules).values({ tenantId: tenant.id, name: "SoD ad-hoc rule", minValue: "0", maxValue: null, departmentId: dept.id }).returning();
      await tx.insert(approvalRuleRequirements).values({ tenantId: tenant.id, ruleId: rule.id, approverRoleId: role.id, groupNo: 1, groupSequence: 1, minApprovalsInGroup: 1 });

      const requisition = await createSubmittedRequisition(tx, requestor.id, dept.id, cc.id);
      await resolveApprovals(tx, tenant.id, requisition.id);

      const [actingRequirement] = await tx
        .select()
        .from(requisitionApprovalRequirements)
        .where(and(eq(requisitionApprovalRequirements.requisitionId, requisition.id), eq(requisitionApprovalRequirements.assignedUserId, otherApprover.id)));
      expect(actingRequirement).toBeDefined();

      const result = await addAdHocApprover(tx, tenant.id, otherApprover.id, requisition.id, requestor.id, "trying to add the requestor");
      expect(result.error).toBeDefined();

      const stillPending = await tx
        .select()
        .from(requisitionApprovalRequirements)
        .where(eq(requisitionApprovalRequirements.requisitionId, requisition.id));
      expect(stillPending.some((r) => r.assignedUserId === requestor.id)).toBe(false);
    });
  });
});
