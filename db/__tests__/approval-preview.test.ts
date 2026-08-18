import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "../adminClient";
import { withTenant } from "../withTenant";
import { previewApprovalChain } from "../approvalPreview";
import { resolveApprovals } from "../approvals";
import {
  approvalDecisionLog,
  auditLog,
  approvalRuleRequirements,
  approvalRules,
  departments,
  purchaseRequisitions,
  requisitionApprovalRequirements,
  roles,
  tenants,
  userRoles,
  users,
} from "../schema";

/**
 * The preview has one job: say the same thing the engine will do.
 *
 * A preview that drifts from resolveApprovals() is worse than none — it
 * would be confidently wrong at exactly the moment somebody is deciding
 * whether to trust the system. So the test that matters compares the
 * preview against what actually happens on submit, rather than against a
 * hand-written expectation.
 */

let tenant: typeof tenants.$inferSelect;
let requestor: typeof users.$inferSelect;
let head: typeof users.$inferSelect;
let finance: typeof users.$inferSelect;
let dept: typeof departments.$inferSelect;

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  [tenant] = await adminDb
    .insert(tenants)
    .values({ name: "Preview Co", slug: `preview-co-${suffix}` })
    .returning();

  await withTenant(tenant.id, async (tx) => {
    [dept] = await tx.insert(departments).values({ tenantId: tenant.id, name: "Ops" }).returning();
    [requestor] = await tx
      .insert(users)
      .values({ tenantId: tenant.id, email: `req-${suffix}@example.com`, fullName: "Rita Requestor", status: "active" })
      .returning();
    [head] = await tx
      .insert(users)
      .values({ tenantId: tenant.id, email: `head-${suffix}@example.com`, fullName: "Hari Head", status: "active" })
      .returning();
    [finance] = await tx
      .insert(users)
      .values({ tenantId: tenant.id, email: `fin-${suffix}@example.com`, fullName: "Farah Finance", status: "active" })
      .returning();

    const [headRole] = await tx
      .insert(roles)
      .values({ tenantId: tenant.id, key: "department_head", displayName: "Department head" })
      .returning();
    const [financeRole] = await tx
      .insert(roles)
      .values({ tenantId: tenant.id, key: "finance_approver", displayName: "Finance approver" })
      .returning();

    await tx.insert(userRoles).values([
      { tenantId: tenant.id, userId: head.id, roleId: headRole.id, scopeType: "global" },
      { tenantId: tenant.id, userId: finance.id, roleId: financeRole.id, scopeType: "global" },
    ]);

    const [rule] = await tx
      .insert(approvalRules)
      .values({
        tenantId: tenant.id,
        name: "Anything over 1000",
        minValue: "1000",
        currency: "INR",
        priority: 10,
        combinationMode: "additive",
        active: true,
      })
      .returning();
    await tx.insert(approvalRuleRequirements).values([
      { tenantId: tenant.id, ruleId: rule.id, groupNo: 1, groupSequence: 1, approverRoleId: headRole.id, minApprovalsInGroup: 1 },
      { tenantId: tenant.id, ruleId: rule.id, groupNo: 2, groupSequence: 1, approverRoleId: financeRole.id, minApprovalsInGroup: 1 },
    ]);
  });
});

afterAll(async () => {
  // resolveApprovals() writes an audit row and may write notifications;
  // both hold a tenant FK, so they go before the tenant does.
  await adminDb.delete(auditLog).where(eq(auditLog.tenantId, tenant.id));
  await adminDb.delete(approvalDecisionLog).where(eq(approvalDecisionLog.tenantId, tenant.id));
  await adminDb.delete(requisitionApprovalRequirements).where(eq(requisitionApprovalRequirements.tenantId, tenant.id));
  await adminDb.delete(purchaseRequisitions).where(eq(purchaseRequisitions.tenantId, tenant.id));
  await adminDb.delete(approvalRuleRequirements).where(eq(approvalRuleRequirements.tenantId, tenant.id));
  await adminDb.delete(approvalRules).where(eq(approvalRules.tenantId, tenant.id));
  await adminDb.delete(userRoles).where(eq(userRoles.tenantId, tenant.id));
  await adminDb.delete(roles).where(eq(roles.tenantId, tenant.id));
  await adminDb.delete(users).where(eq(users.tenantId, tenant.id));
  await adminDb.delete(departments).where(eq(departments.tenantId, tenant.id));
  await adminDb.delete(tenants).where(eq(tenants.id, tenant.id));
});

const scope = (value: string) => ({
  currency: "INR",
  totalEstimatedValue: value,
  departmentId: dept.id,
  costCenterId: null,
  lineCategoryIds: [] as string[],
});

describe("approval preview", () => {
  it("names both steps, in order, before anything is submitted", async () => {
    const preview = await withTenant(tenant.id, (tx) => previewApprovalChain(tx, tenant.id, scope("5000"), requestor.id));

    expect(preview.autoApproves).toBe(false);
    expect(preview.steps.map((s) => s.groupNo)).toEqual([1, 2]);
    expect(preview.steps[0].approvers).toEqual(["Hari Head"]);
    expect(preview.steps[1].approvers).toEqual(["Farah Finance"]);
    expect(preview.ruleNames).toContain("Anything over 1000");
  });

  it("warns that submitting will auto-approve when no rule matches", async () => {
    // Below the rule's minimum, so nothing matches at all.
    const preview = await withTenant(tenant.id, (tx) => previewApprovalChain(tx, tenant.id, scope("10"), requestor.id));

    expect(preview.autoApproves).toBe(true);
    expect(preview.steps).toEqual([]);
  });

  it("never lists the requester, who cannot approve their own requisition", async () => {
    const preview = await withTenant(tenant.id, (tx) => previewApprovalChain(tx, tenant.id, scope("5000"), head.id));

    // Hari raised it this time, so step 1 has nobody left and drops out.
    expect(preview.steps.flatMap((s) => s.approvers)).not.toContain("Hari Head");
  });

  it("resolves approvals for a requisition with no department or cost centre", async () => {
    // Both columns are nullable and the form offers "—" for each, so this
    // is a submission a user can actually make. It used to throw:
    // `costCenterId ?? ""` bound an empty string to a uuid parameter and
    // Postgres rejected the whole query, so submitting blew up instead of
    // resolving. Found by the preview, fixed in findMatchingRules().
    const requisition = await withTenant(tenant.id, async (tx) => {
      const [r] = await tx
        .insert(purchaseRequisitions)
        .values({
          tenantId: tenant.id,
          requestorId: requestor.id,
          departmentId: null,
          costCenterId: null,
          status: "submitted",
          totalEstimatedValue: "5000",
          currency: "INR",
        })
        .returning();
      await resolveApprovals(tx, tenant.id, r.id);
      return r;
    });

    const [after] = await withTenant(tenant.id, (tx) =>
      tx.select().from(purchaseRequisitions).where(eq(purchaseRequisitions.id, requisition.id)),
    );
    // The rule has no department or cost-centre scope, so it still matches
    // and the requisition lands in approval rather than auto-approving.
    expect(after.status).toBe("pending_approval");
  });

  it("matches what resolveApprovals actually does on submit", async () => {
    // The test that matters: preview, then really submit, and compare.
    const preview = await withTenant(tenant.id, (tx) => previewApprovalChain(tx, tenant.id, scope("5000"), requestor.id));

    const requisition = await withTenant(tenant.id, async (tx) => {
      const [r] = await tx
        .insert(purchaseRequisitions)
        .values({
          tenantId: tenant.id,
          requestorId: requestor.id,
          departmentId: dept.id,
          status: "submitted",
          totalEstimatedValue: "5000",
          currency: "INR",
        })
        .returning();
      await resolveApprovals(tx, tenant.id, r.id);
      return r;
    });

    const actual = await withTenant(tenant.id, (tx) =>
      tx.select().from(requisitionApprovalRequirements).where(eq(requisitionApprovalRequirements.requisitionId, requisition.id)),
    );
    const actualUsers = await withTenant(tenant.id, (tx) => tx.select().from(users));
    const nameOf = (id: string) => actualUsers.find((u) => u.id === id)?.fullName;

    const actualByGroup = [...new Set(actual.map((r) => r.groupNo))].sort().map((g) => ({
      groupNo: g,
      approvers: actual.filter((r) => r.groupNo === g).map((r) => nameOf(r.assignedUserId)).sort(),
    }));
    const previewByGroup = preview.steps.map((s) => ({ groupNo: s.groupNo, approvers: [...s.approvers].sort() }));

    expect(previewByGroup).toEqual(actualByGroup);
  });
});
