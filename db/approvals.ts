import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { db } from "./client";
import { logAction } from "./audit";
import {
  purchaseRequisitions,
  purchaseRequisitionLines,
  approvalRules,
  approvalRuleRequirements,
  requisitionApprovalRequirements,
  userRoles,
} from "./schema";

/**
 * Runs at submit time. Matches active approval_rules against the
 * requisition (value range + currency, department/cost-center/category
 * wildcards), resolves each matched rule's role requirements to actual
 * users via user_roles, and freezes the result as
 * requisition_approval_requirements rows.
 *
 * combination_mode: rules are walked priority-desc; the first `exclusive`
 * rule encountered keeps itself and everything already collected (equal
 * or higher priority) but drops every rule below it. `additive` rules
 * simply union.
 *
 * minApprovalsInGroup is applied at assignment time, not as a runtime
 * quorum: for a given role requirement, the N most scope-specific
 * eligible users are assigned (cost-center scope beats department beats
 * global), and every assigned row must approve — not "any N of the
 * eligible pool". requisition_approval_requirements has no column tying
 * a row back to a specific approval_rule_requirements row, so a
 * partial-quorum-among-a-larger-pool model isn't reconstructable later;
 * assigning exactly N named approvers up front sidesteps that instead of
 * getting it wrong silently.
 *
 * No matching rule, or rules that resolve to zero eligible approvers,
 * auto-approves the requisition rather than leaving it stuck in
 * pending_approval with nobody who can act on it.
 */
export async function resolveApprovals(tx: typeof db, tenantId: string, requisitionId: string) {
  const [requisition] = await tx
    .select()
    .from(purchaseRequisitions)
    .where(eq(purchaseRequisitions.id, requisitionId));
  if (!requisition) throw new Error(`resolveApprovals: requisition ${requisitionId} not found`);

  const lines = await tx
    .select({ categoryId: purchaseRequisitionLines.categoryId })
    .from(purchaseRequisitionLines)
    .where(eq(purchaseRequisitionLines.requisitionId, requisitionId));
  const lineCategoryIds = [...new Set(lines.map((l) => l.categoryId).filter((id): id is string => id !== null))];

  const candidateRules = await tx
    .select()
    .from(approvalRules)
    .where(
      and(
        eq(approvalRules.tenantId, tenantId),
        eq(approvalRules.active, true),
        eq(approvalRules.currency, requisition.currency),
        sql`${approvalRules.effectiveFrom} <= now()`,
        or(isNull(approvalRules.effectiveTo), sql`${approvalRules.effectiveTo} >= now()`),
        sql`${approvalRules.minValue} <= ${requisition.totalEstimatedValue}`,
        or(isNull(approvalRules.maxValue), sql`${approvalRules.maxValue} >= ${requisition.totalEstimatedValue}`),
        or(isNull(approvalRules.departmentId), eq(approvalRules.departmentId, requisition.departmentId ?? "")),
        or(isNull(approvalRules.costCenterId), eq(approvalRules.costCenterId, requisition.costCenterId ?? "")),
        lineCategoryIds.length > 0
          ? or(isNull(approvalRules.categoryId), inArray(approvalRules.categoryId, lineCategoryIds))
          : isNull(approvalRules.categoryId),
      ),
    )
    .orderBy(sql`${approvalRules.priority} desc`);

  const matchingRules: (typeof candidateRules)[number][] = [];
  for (const rule of candidateRules) {
    matchingRules.push(rule);
    if (rule.combinationMode === "exclusive") break;
  }

  if (matchingRules.length === 0) {
    await autoApprove(tx, tenantId, requisition.id, "no matching approval rule");
    return;
  }

  const requirementRows: (typeof requisitionApprovalRequirements.$inferInsert)[] = [];
  const seen = new Set<string>();

  for (const rule of matchingRules) {
    const ruleRequirements = await tx
      .select()
      .from(approvalRuleRequirements)
      .where(eq(approvalRuleRequirements.ruleId, rule.id));

    for (const req of ruleRequirements) {
      const eligible = await tx
        .select({ userId: userRoles.userId, scopeType: userRoles.scopeType })
        .from(userRoles)
        .where(
          and(
            eq(userRoles.roleId, req.approverRoleId),
            or(
              eq(userRoles.scopeType, "global"),
              and(eq(userRoles.scopeType, "department"), eq(userRoles.scopeId, requisition.departmentId ?? "")),
              and(eq(userRoles.scopeType, "cost_center"), eq(userRoles.scopeId, requisition.costCenterId ?? "")),
            ),
          ),
        );

      const specificity = { cost_center: 0, department: 1, global: 2 } as const;
      eligible.sort((a, b) => specificity[a.scopeType] - specificity[b.scopeType]);

      const selected = eligible.slice(0, req.minApprovalsInGroup);
      for (const { userId } of selected) {
        const key = `${userId}:${req.groupNo}`;
        if (seen.has(key)) continue;
        seen.add(key);
        requirementRows.push({
          tenantId,
          requisitionId: requisition.id,
          source: "rule",
          sourceRuleId: rule.id,
          assignedUserId: userId,
          groupNo: req.groupNo,
          groupSequence: req.groupSequence,
          status: "pending",
        });
      }
    }
  }

  if (requirementRows.length === 0) {
    await autoApprove(tx, tenantId, requisition.id, "matched rules resolved to zero eligible approvers");
    return;
  }

  await tx.insert(requisitionApprovalRequirements).values(requirementRows);
  await tx
    .update(purchaseRequisitions)
    .set({ status: "pending_approval" })
    .where(eq(purchaseRequisitions.id, requisition.id));

  await logAction(tx, {
    tenantId,
    action: "requisition.approval_resolved",
    entityType: "purchase_requisition",
    entityId: requisition.id,
    metadata: { approverCount: requirementRows.length, ruleIds: matchingRules.map((r) => r.id) },
  });
}

async function autoApprove(tx: typeof db, tenantId: string, requisitionId: string, reason: string) {
  await tx.update(purchaseRequisitions).set({ status: "approved" }).where(eq(purchaseRequisitions.id, requisitionId));
  await logAction(tx, {
    tenantId,
    action: "requisition.auto_approved",
    entityType: "purchase_requisition",
    entityId: requisitionId,
    metadata: { reason },
  });
}

/**
 * The "current group" for a requisition is whichever group_no is lowest
 * among its still-pending rows — no separate stage-tracking column
 * needed, it falls out of the data. A row is actionable only if it sits
 * in that group; approving the last row of a group naturally exposes the
 * next one on the following read.
 */
export async function isCurrentGroup(tx: typeof db, requisitionId: string, groupNo: number): Promise<boolean> {
  const [row] = await tx
    .select({ minGroup: sql<number | null>`min(${requisitionApprovalRequirements.groupNo})` })
    .from(requisitionApprovalRequirements)
    .where(
      and(
        eq(requisitionApprovalRequirements.requisitionId, requisitionId),
        eq(requisitionApprovalRequirements.status, "pending"),
      ),
    );
  return row?.minGroup === groupNo;
}

export async function checkFullyApproved(tx: typeof db, tenantId: string, requisitionId: string) {
  const [row] = await tx
    .select({ pendingCount: sql<number>`count(*) filter (where ${requisitionApprovalRequirements.status} = 'pending')` })
    .from(requisitionApprovalRequirements)
    .where(eq(requisitionApprovalRequirements.requisitionId, requisitionId));

  if (Number(row?.pendingCount ?? 0) === 0) {
    await tx.update(purchaseRequisitions).set({ status: "approved" }).where(eq(purchaseRequisitions.id, requisitionId));
    await logAction(tx, {
      tenantId,
      action: "requisition.approved",
      entityType: "purchase_requisition",
      entityId: requisitionId,
      metadata: {},
    });
  }
}
