import { LIFECYCLE_STEPS, type LifecycleStepKey } from "@/lib/lifecycle";

/**
 * Which of the seven stages a person actually touches, from the roles
 * they hold.
 *
 * The point of showing this on day one is not to teach the whole process
 * — it is to show how little of it is yours. A requestor meeting AWA
 * sees eleven nav items and reasonably assumes all of it is their job.
 * Two of seven stages is a much smaller thing to learn.
 *
 * Keyed on roles.key, which is the stable identifier — display names are
 * renamed freely by tenants (Admin › Roles), so matching on those would
 * quietly stop working the first time somebody called their finance
 * approver something else.
 */
const STAGES_BY_ROLE: Record<string, LifecycleStepKey[]> = {
  requestor: ["requisition"],
  department_head: ["approval"],
  finance_approver: ["approval", "invoice", "payment"],
  cfo_controller: ["approval"],
  procurement_officer: ["sourcing", "purchase_order", "receipt"],
  tenant_admin: [],
};

/** Who does each stage, for the stages that aren't yours. Deliberately vague where the answer is "whoever is there". */
export const STAGE_OWNER_HINT: Record<LifecycleStepKey, string> = {
  requisition: "whoever needs something",
  approval: "approvers",
  sourcing: "procurement",
  purchase_order: "procurement",
  receipt: "whoever takes delivery",
  invoice: "finance",
  payment: "finance",
};

export function stagesForRoles(roleKeys: string[]): LifecycleStepKey[] {
  const owned = new Set<LifecycleStepKey>();
  for (const key of roleKeys) {
    for (const step of STAGES_BY_ROLE[key] ?? []) owned.add(step);
  }
  // Anyone can raise a requisition, whatever roles they hold — it is the
  // one stage with no role gate, so somebody with only an approver role
  // should still be told they can ask for things.
  owned.add("requisition");
  return LIFECYCLE_STEPS.filter((s) => owned.has(s.key)).map((s) => s.key);
}
