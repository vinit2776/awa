import { inArray } from "drizzle-orm";
import type { db } from "./client";
import { findMatchingRules, selectApprovers, type ApprovalScope } from "./approvals";
import { approvalRuleRequirements, roles, users } from "./schema";

/**
 * Who a requisition will go to, before it is submitted.
 *
 * The single most common question a first-time requester has is "and
 * then what happens?", and until now the form gave no answer at all: you
 * pressed Submit and found out afterwards. Worse, a tenant with no
 * matching rule auto-approves, so "nothing happens, it's approved" is
 * also a real answer nobody was being told.
 *
 * This deliberately reuses findMatchingRules() and selectApprovers()
 * from the real engine rather than reimplementing the matching. A
 * preview that drifts from what actually happens is worse than no
 * preview — it would be confidently wrong at exactly the moment somebody
 * is deciding whether to trust the system.
 *
 * Read-only: nothing is written, and it is safe to call on every
 * keystroke-free form change.
 */
export type ApprovalPreview = {
  /** Ordered approval steps. Empty when nothing will be required. */
  steps: { groupNo: number; roleName: string; approvers: string[] }[];
  /** Names of the rules that matched, for "via …". */
  ruleNames: string[];
  /**
   * True when submitting will approve the requisition outright — either
   * no rule matched, or the matched rules resolve to nobody eligible.
   * The same auto-approve path resolveApprovals() takes.
   */
  autoApproves: boolean;
};

export async function previewApprovalChain(
  tx: typeof db,
  tenantId: string,
  scope: ApprovalScope,
  requestorId: string,
): Promise<ApprovalPreview> {
  const matchingRules = await findMatchingRules(tx, tenantId, scope);
  if (matchingRules.length === 0) {
    return { steps: [], ruleNames: [], autoApproves: true };
  }

  const ruleRequirements = await tx
    .select()
    .from(approvalRuleRequirements)
    .where(inArray(approvalRuleRequirements.ruleId, matchingRules.map((r) => r.id)));

  const roleRows = ruleRequirements.length
    ? await tx.select().from(roles).where(inArray(roles.id, [...new Set(ruleRequirements.map((r) => r.approverRoleId))]))
    : [];
  const roleName = (id: string) => roleRows.find((r) => r.id === id)?.displayName ?? "Approver";

  const steps: ApprovalPreview["steps"] = [];
  const seen = new Set<string>();

  for (const requirement of ruleRequirements.sort((a, b) => a.groupNo - b.groupNo)) {
    const selected = await selectApprovers(tx, {
      roleId: requirement.approverRoleId,
      excludeUserId: requestorId,
      departmentId: scope.departmentId,
      costCenterId: scope.costCenterId,
      take: requirement.minApprovalsInGroup,
    });
    if (selected.length === 0) continue;

    const names = selected.length
      ? (await tx.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, selected.map((s) => s.userId))))
          .map((u) => u.fullName)
      : [];

    // Same de-duplication rule the engine applies: one person cannot be
    // asked twice for the same group, even if two rules both select them.
    const fresh = names.filter((n) => !seen.has(`${n}:${requirement.groupNo}`));
    for (const n of fresh) seen.add(`${n}:${requirement.groupNo}`);
    if (fresh.length === 0) continue;

    steps.push({ groupNo: requirement.groupNo, roleName: roleName(requirement.approverRoleId), approvers: fresh });
  }

  return {
    steps,
    ruleNames: matchingRules.map((r) => r.name),
    // Matched rules that resolve to nobody eligible auto-approve too —
    // the second of resolveApprovals()'s two auto-approve paths.
    autoApproves: steps.length === 0,
  };
}

