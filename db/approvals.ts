import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { db } from "./client";
import { logAction } from "./audit";
import { notifyUser } from "./notifications";
import {
  purchaseRequisitions,
  purchaseRequisitionLines,
  approvalRules,
  approvalRuleRequirements,
  requisitionApprovalRequirements,
  approvalDecisionLog,
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
 * Segregation of duties (§02): the requestor is never eligible to
 * approve their own requisition, even if they hold a role that would
 * otherwise qualify — found live, not in review: nothing stopped a
 * requestor who also held an approver role for their own request's
 * scope from approving themselves, unlike goods receipt's DB-trigger-
 * enforced "receiver can't be requestor". Excluding them can genuinely
 * drop a requirement to zero eligible people (a one-person tenant, or
 * whoever holds that role scoped to this department/cost-center is
 * exactly the requestor) — that's not a bug to special-case, it falls
 * straight into the same "zero eligible approvers" auto-approve path
 * below that already exists for the identical situation with no
 * self-approval involved.
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
            ne(userRoles.userId, requisition.requestorId),
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

  await notifyCurrentGroup(tx, requisition.id);
}

async function autoApprove(tx: typeof db, tenantId: string, requisitionId: string, reason: string) {
  const [requisition] = await tx
    .update(purchaseRequisitions)
    .set({ status: "approved" })
    .where(eq(purchaseRequisitions.id, requisitionId))
    .returning();
  await logAction(tx, {
    tenantId,
    action: "requisition.auto_approved",
    entityType: "purchase_requisition",
    entityId: requisitionId,
    metadata: { reason },
  });
  await notifyUser(
    tx,
    requisition.requestorId,
    "requisition_approved",
    "Your requisition was approved",
    `No approval was required (${reason}).`,
  );
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

// Notifies whoever is in the current group. Called once when a
// requisition first enters pending_approval, and again after every
// approve — cheap to over-call (a still-open group's other member gets a
// redundant nudge rather than silence) and simpler than tracking "have we
// already notified this person for this group" separately.
async function notifyCurrentGroup(tx: typeof db, requisitionId: string) {
  const pending = await tx
    .select({ assignedUserId: requisitionApprovalRequirements.assignedUserId, groupNo: requisitionApprovalRequirements.groupNo })
    .from(requisitionApprovalRequirements)
    .where(
      and(
        eq(requisitionApprovalRequirements.requisitionId, requisitionId),
        eq(requisitionApprovalRequirements.status, "pending"),
      ),
    );
  if (pending.length === 0) return;
  const currentGroup = Math.min(...pending.map((p) => p.groupNo));

  // Starts the escalation SLA clock for this group — coalesce so a
  // repeat call (another still-pending member of the same group) never
  // resets a timer that's already running.
  await tx
    .update(requisitionApprovalRequirements)
    .set({ actionableAt: sql`coalesce(${requisitionApprovalRequirements.actionableAt}, now())` })
    .where(
      and(
        eq(requisitionApprovalRequirements.requisitionId, requisitionId),
        eq(requisitionApprovalRequirements.status, "pending"),
        eq(requisitionApprovalRequirements.groupNo, currentGroup),
      ),
    );

  for (const p of pending.filter((p) => p.groupNo === currentGroup)) {
    await notifyUser(tx, p.assignedUserId, "approval_needed", "A requisition needs your approval", "Open your approvals inbox to review it.");
  }
}

export async function checkFullyApproved(tx: typeof db, tenantId: string, requisitionId: string) {
  const [row] = await tx
    .select({ pendingCount: sql<number>`count(*) filter (where ${requisitionApprovalRequirements.status} = 'pending')` })
    .from(requisitionApprovalRequirements)
    .where(eq(requisitionApprovalRequirements.requisitionId, requisitionId));

  if (Number(row?.pendingCount ?? 0) === 0) {
    const [requisition] = await tx
      .update(purchaseRequisitions)
      .set({ status: "approved" })
      .where(eq(purchaseRequisitions.id, requisitionId))
      .returning();
    await logAction(tx, {
      tenantId,
      action: "requisition.approved",
      entityType: "purchase_requisition",
      entityId: requisitionId,
      metadata: {},
    });
    await notifyUser(tx, requisition.requestorId, "requisition_approved", "Your requisition was approved", "All required approvals are in.");
  } else {
    await notifyCurrentGroup(tx, requisitionId);
  }
}

/**
 * Handles both reject outcomes (§04): "rejected with defects" returns to
 * the requestor to revise and resubmit; "rejected and closed" ends the
 * PR permanently. Either way, every other still-pending row for this
 * round is closed out too — they'll never be actioned now, and leaving
 * them pending would corrupt the current-group calculation if the
 * requestor later resubmits and a fresh round of rows gets created for
 * the same requisitionId. Already-decided (approved) rows are left
 * alone as the historical record.
 */
export async function rejectRequisition(
  tx: typeof db,
  tenantId: string,
  actorUserId: string,
  requirementId: string,
  closure: "revisable" | "closed",
  comment: string,
): Promise<{ error?: string }> {
  const [requirement] = await tx
    .select()
    .from(requisitionApprovalRequirements)
    .where(
      and(
        eq(requisitionApprovalRequirements.id, requirementId),
        eq(requisitionApprovalRequirements.assignedUserId, actorUserId),
        eq(requisitionApprovalRequirements.status, "pending"),
      ),
    );
  if (!requirement) return { error: "Not found, or already decided." };
  if (!(await isCurrentGroup(tx, requirement.requisitionId, requirement.groupNo))) {
    return { error: "It isn't your turn to decide on this requisition yet." };
  }

  await tx
    .update(requisitionApprovalRequirements)
    .set({ status: "rejected", decidedAt: new Date(), decisionComment: comment })
    .where(eq(requisitionApprovalRequirements.id, requirement.id));

  await tx.insert(approvalDecisionLog).values({
    tenantId,
    requisitionApprovalRequirementId: requirement.id,
    actorUserId,
    action: "rejected",
    comment,
  });

  await tx
    .update(requisitionApprovalRequirements)
    .set({ status: "rejected", decidedAt: new Date(), decisionComment: "Superseded — requisition rejected." })
    .where(
      and(
        eq(requisitionApprovalRequirements.requisitionId, requirement.requisitionId),
        eq(requisitionApprovalRequirements.status, "pending"),
      ),
    );

  const newStatus = closure === "closed" ? "rejected_closed" : "rejected_revisable";
  const [updatedRequisition] = await tx
    .update(purchaseRequisitions)
    .set({ status: newStatus })
    .where(eq(purchaseRequisitions.id, requirement.requisitionId))
    .returning();

  await logAction(tx, {
    tenantId,
    actorUserId,
    action: closure === "closed" ? "requisition.rejected_closed" : "requisition.rejected_revisable",
    entityType: "purchase_requisition",
    entityId: requirement.requisitionId,
    metadata: { comment },
  });

  await notifyUser(
    tx,
    updatedRequisition.requestorId,
    "requisition_rejected",
    closure === "closed" ? "Your requisition was rejected and closed" : "Your requisition needs revisions",
    `Reason: ${comment}`,
  );

  return {};
}

/**
 * Lets whoever currently has an actionable pending row pull in another
 * approver mid-flight (§04). Same segregation-of-duties rule
 * resolveApprovals enforces at submit time above — this is the other
 * door into requisition_approval_requirements, and it had no equivalent
 * check, so a requestor could still end up approving their own
 * requisition through it even with that fix in place.
 */
export async function addAdHocApprover(
  tx: typeof db,
  tenantId: string,
  actorUserId: string,
  requisitionId: string,
  assignedUserId: string,
  reason: string,
): Promise<{ error?: string }> {
  const [actingRequirement] = await tx
    .select()
    .from(requisitionApprovalRequirements)
    .where(
      and(
        eq(requisitionApprovalRequirements.requisitionId, requisitionId),
        eq(requisitionApprovalRequirements.assignedUserId, actorUserId),
        eq(requisitionApprovalRequirements.status, "pending"),
      ),
    );
  if (!actingRequirement) return { error: "You don't have an actionable decision on this requisition." };
  if (!(await isCurrentGroup(tx, requisitionId, actingRequirement.groupNo))) {
    return { error: "It isn't your turn to decide on this requisition yet." };
  }

  const [requisition] = await tx.select().from(purchaseRequisitions).where(eq(purchaseRequisitions.id, requisitionId));
  if (requisition?.requestorId === assignedUserId) {
    return { error: "The requestor can't be added as an approver on their own requisition." };
  }

  const [created] = await tx
    .insert(requisitionApprovalRequirements)
    .values({
      tenantId,
      requisitionId,
      source: "ad_hoc",
      assignedUserId,
      groupNo: actingRequirement.groupNo,
      groupSequence: actingRequirement.groupSequence,
      addedByUserId: actorUserId,
      reason,
      status: "pending",
      // Inserted directly into the current group (isCurrentGroup checked
      // above) — it's immediately actionable, not waiting on an earlier
      // group to clear.
      actionableAt: new Date(),
    })
    .returning();

  await tx.insert(approvalDecisionLog).values({
    tenantId,
    requisitionApprovalRequirementId: created.id,
    actorUserId,
    action: "approver_added",
    comment: reason,
  });
  await logAction(tx, {
    tenantId,
    actorUserId,
    action: "requisition_approval.ad_hoc_added",
    entityType: "requisition_approval_requirement",
    entityId: created.id,
    metadata: { requisitionId, assignedUserId, reason },
  });

  return {};
}
