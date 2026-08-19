"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { describeScope, describeSteps } from "./describeRule";
import { createRuleWithRequirements, type WizardStepInput } from "./actions";

type Ref = { id: string; name: string };
type RoleRef = { id: string; displayName: string };
type ExistingRule = {
  id: string;
  name: string;
  categoryId: string | null;
  departmentId: string | null;
  costCenterId: string | null;
  minValue: string;
  maxValue: string | null;
  currency: string;
  priority: number;
  active: boolean;
};
type ExistingRequirement = { ruleId: string; groupNo: number; approverRoleId: string; minApprovalsInGroup: number };

type WizStepRole = { key: string; approverRoleId: string; minApprovalsInGroup: number };
type WizStep = { key: string; roles: WizStepRole[] };

let keyCounter = 0;
function nextKey() {
  keyCounter += 1;
  return `k${keyCounter}`;
}

function dimMatches(a: string | null, b: string | null) {
  return a === null || b === null || a === b;
}
function rangesOverlap(aMin: number, aMax: number | null, bMin: number, bMax: number | null) {
  const aHi = aMax ?? Infinity;
  const bHi = bMax ?? Infinity;
  return aMin <= bHi && bMin <= aHi;
}

const TOTAL_STEPS = 4;

export function RuleWizard({
  categories,
  departments,
  costCenters,
  roles,
  existingRules,
  existingRequirements,
}: {
  categories: Ref[];
  departments: Ref[];
  costCenters: Ref[];
  roles: RoleRef[];
  existingRules: ExistingRule[];
  existingRequirements: ExistingRequirement[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [wizStep, setWizStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const [minValue, setMinValue] = useState("0");
  const [maxValue, setMaxValue] = useState("");

  const [steps, setSteps] = useState<WizStep[]>([{ key: nextKey(), roles: [] }]);
  const [conflictChoice, setConflictChoice] = useState<"replace" | "alongside" | null>(null);
  const [ruleType, setRuleType] = useState<"requires_approval" | "auto_approve">("requires_approval");

  const scope = { categoryId: categoryId || null, departmentId: departmentId || null, costCenterId: costCenterId || null, minValue, maxValue: maxValue || null, currency: "INR" };

  const conflicts = useMemo(() => {
    const draftCategoryId = categoryId || null;
    const draftDepartmentId = departmentId || null;
    const draftCostCenterId = costCenterId || null;
    const draftMin = Number(minValue || 0);
    const draftMax = maxValue ? Number(maxValue) : null;
    return existingRules.filter((r) => {
      if (!r.active) return false;
      if (!dimMatches(draftCategoryId, r.categoryId)) return false;
      if (!dimMatches(draftDepartmentId, r.departmentId)) return false;
      if (!dimMatches(draftCostCenterId, r.costCenterId)) return false;
      const rMax = r.maxValue !== null ? Number(r.maxValue) : null;
      return rangesOverlap(draftMin, draftMax, Number(r.minValue), rMax);
    });
  }, [categoryId, departmentId, costCenterId, minValue, maxValue, existingRules]);

  const hasConflicts = conflicts.length > 0;
  // Auto-approve is always exclusive — combined additively with another
  // rule's approvers it would contradict its own "no review needed"
  // outcome, so there's no choice to offer here.
  const combinationMode: "additive" | "exclusive" =
    ruleType === "auto_approve" ? "exclusive" : hasConflicts && conflictChoice === "replace" ? "exclusive" : "additive";
  const priority = combinationMode === "exclusive" ? Math.max(0, ...conflicts.map((c) => c.priority)) + 1 : 0;

  function resetWizard() {
    setWizStep(1);
    setName("");
    setCategoryId("");
    setDepartmentId("");
    setCostCenterId("");
    setMinValue("0");
    setMaxValue("");
    setSteps([{ key: nextKey(), roles: [] }]);
    setConflictChoice(null);
    setRuleType("requires_approval");
    setError(null);
  }

  function addStep() {
    setSteps((s) => [...s, { key: nextKey(), roles: [] }]);
  }
  function removeStep(stepKey: string) {
    setSteps((s) => (s.length > 1 ? s.filter((st) => st.key !== stepKey) : s));
  }
  function addRoleToStep(stepKey: string) {
    const firstAvailable = roles[0]?.id ?? "";
    setSteps((s) => s.map((st) => (st.key === stepKey ? { ...st, roles: [...st.roles, { key: nextKey(), approverRoleId: firstAvailable, minApprovalsInGroup: 1 }] } : st)));
  }
  function removeRole(stepKey: string, roleKey: string) {
    setSteps((s) => s.map((st) => (st.key === stepKey ? { ...st, roles: st.roles.filter((r) => r.key !== roleKey) } : st)));
  }
  function setRoleField(stepKey: string, roleKey: string, field: "approverRoleId" | "minApprovalsInGroup", value: string) {
    setSteps((s) =>
      s.map((st) =>
        st.key === stepKey
          ? { ...st, roles: st.roles.map((r) => (r.key === roleKey ? { ...r, [field]: field === "minApprovalsInGroup" ? Number(value) || 1 : value } : r)) }
          : st,
      ),
    );
  }

  // Every step present must have at least one role — an empty step
  // used to pass validation silently (steps.some, not steps.every) and
  // get dropped at save time with no indication anything was lost.
  // Auto-approve rules bypass this by deliberate choice, not by leaving
  // steps empty by omission.
  const step2Valid = ruleType === "auto_approve" || (steps.length > 0 && steps.every((s) => s.roles.length > 0));
  const step3Valid = !hasConflicts || conflictChoice !== null;

  async function handleSave() {
    setSaving(true);
    setError(null);
    const payload: WizardStepInput[] =
      ruleType === "auto_approve"
        ? []
        : steps.filter((s) => s.roles.length > 0).map((s) => s.roles.map((r) => ({ approverRoleId: r.approverRoleId, minApprovalsInGroup: r.minApprovalsInGroup })));
    const result = await createRuleWithRequirements({
      name,
      categoryId: scope.categoryId,
      departmentId: scope.departmentId,
      costCenterId: scope.costCenterId,
      minValue: minValue || "0",
      maxValue: maxValue || null,
      combinationMode,
      priority,
      steps: payload,
      ruleType,
    });
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setOpen(false);
    resetWizard();
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={cn(buttonVariants())}>
        + New rule
      </button>
    );
  }

  const activeSteps = steps.filter((s) => s.roles.length > 0);
  const reviewRequirements = activeSteps.flatMap((s, i) => s.roles.map((r) => ({ groupNo: i + 1, approverRoleId: r.approverRoleId, minApprovalsInGroup: r.minApprovalsInGroup })));

  return (
    <div className="flex flex-col gap-4 rounded-lg border p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-base text-foreground">New approval rule</h2>
        <div className="flex items-center gap-1.5">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((n) => (
            <span
              key={n}
              className="flex h-5 w-5 items-center justify-center rounded-full border font-mono text-[10px] font-bold"
              style={
                n < wizStep
                  ? { background: "var(--success)", color: "var(--success-foreground)", borderColor: "var(--success)" }
                  : n === wizStep
                    ? { background: "var(--primary)", color: "var(--primary-foreground)", borderColor: "var(--primary)" }
                    : { background: "var(--muted)", color: "var(--muted-foreground)", borderColor: "var(--border)" }
              }
            >
              {n < wizStep ? "✓" : n}
            </span>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {wizStep === 1 && (
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-sm font-medium">When does this rule apply?</p>
            <p className="text-xs text-muted-foreground">Leave anything as &quot;Any&quot; to match every purchase on that dimension.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm leading-loose">
            Any purchase in
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="h-8 rounded-md border px-2 text-sm">
              <option value="">Any category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            from
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="h-8 rounded-md border px-2 text-sm">
              <option value="">Any department</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            billed to
            <select value={costCenterId} onChange={(e) => setCostCenterId(e.target.value)} className="h-8 rounded-md border px-2 text-sm">
              <option value="">Any cost center</option>
              {costCenters.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            between ₹
            <input value={minValue} onChange={(e) => setMinValue(e.target.value)} type="number" step="0.01" className="h-8 w-24 rounded-md border px-2 text-sm" />
            and ₹
            <input value={maxValue} onChange={(e) => setMaxValue(e.target.value)} type="number" step="0.01" placeholder="no limit" className="h-8 w-24 rounded-md border px-2 text-sm" />
          </div>
          <div className="flex items-center gap-2 text-sm">
            Call this rule
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. IT purchases over 50k" className="h-8 w-64 rounded-md border px-2 text-sm" />
          </div>
        </div>
      )}

      {wizStep === 2 && (
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-sm font-medium">Does this need approval?</p>
            <p className="text-xs text-muted-foreground">Most rules route to someone — but a low-value, routine purchase can skip review entirely.</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setRuleType("requires_approval")}
              className="rounded-md border p-3 text-left"
              style={{ background: "var(--card)", borderColor: ruleType === "requires_approval" ? "var(--primary)" : "var(--border)" }}
            >
              <p className="text-sm font-medium">Requires approval</p>
              <p className="text-xs text-muted-foreground">Route to specific roles, in one or more steps.</p>
            </button>
            <button
              type="button"
              onClick={() => setRuleType("auto_approve")}
              className="rounded-md border p-3 text-left"
              style={{ background: "var(--card)", borderColor: ruleType === "auto_approve" ? "var(--primary)" : "var(--border)" }}
            >
              <p className="text-sm font-medium">Auto-approve, no review needed</p>
              <p className="text-xs text-muted-foreground">Submitting approves it immediately and it goes straight to sourcing.</p>
            </button>
          </div>
          {ruleType === "requires_approval" && (
            <>
              {steps.map((s, i) => (
                <div key={s.key} className="rounded-md border p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="font-mono text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--primary)" }}>Step {i + 1}</p>
                    {steps.length > 1 && (
                      <button type="button" onClick={() => removeStep(s.key)} className="text-xs text-muted-foreground hover:text-destructive">
                        Remove step
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {s.roles.map((r) => (
                      <span key={r.key} className="inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs" style={{ background: "var(--accent)" }}>
                        <select
                          value={r.approverRoleId}
                          onChange={(e) => setRoleField(s.key, r.key, "approverRoleId", e.target.value)}
                          className="bg-transparent text-xs font-medium"
                        >
                          {roles.map((role) => (
                            <option key={role.id} value={role.id}>{role.displayName}</option>
                          ))}
                        </select>
                        <button type="button" onClick={() => removeRole(s.key, r.key)} className="text-muted-foreground hover:text-foreground" aria-label="Remove role">
                          ×
                        </button>
                      </span>
                    ))}
                    <button type="button" onClick={() => addRoleToStep(s.key)} className="rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground">
                      + Add another role to this step
                    </button>
                  </div>
                  {s.roles.length === 0 && (
                    <p className="mt-2 text-xs text-destructive">Add a role to this step, or remove it — an empty step can&apos;t be saved.</p>
                  )}
                  {s.roles.length > 0 && (
                    <details className="mt-2 text-xs text-muted-foreground">
                      <summary className="cursor-pointer">Advanced: require more than one approver for a role</summary>
                      <div className="mt-2 flex flex-col gap-1.5">
                        {s.roles.map((r) => (
                          <label key={r.key} className="flex items-center gap-2">
                            {roles.find((role) => role.id === r.approverRoleId)?.displayName}: require
                            <input
                              type="number"
                              min="1"
                              value={r.minApprovalsInGroup}
                              onChange={(e) => setRoleField(s.key, r.key, "minApprovalsInGroup", e.target.value)}
                              className="h-6 w-14 rounded-md border px-1.5 text-xs"
                            />
                            approver(s)
                          </label>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              ))}
              <button type="button" onClick={addStep} className="w-fit rounded-md border border-dashed px-3 py-1.5 text-xs text-muted-foreground">
                + Add another step
              </button>
            </>
          )}
        </div>
      )}

      {wizStep === 3 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium">Checking for overlapping rules…</p>
          {!hasConflicts && (
            <div className="rounded-md border p-3 text-sm" style={{ borderColor: "var(--success)", color: "var(--success)" }}>
              ✓ No existing rule covers this same combination — nothing to resolve.
            </div>
          )}
          {hasConflicts && (
            <div className="flex flex-col gap-3 rounded-md border p-3" style={{ borderColor: "var(--warning)", background: "var(--muted)" }}>
              {conflicts.map((c) => {
                const reqs = existingRequirements.filter((r) => r.ruleId === c.id);
                return (
                  <div key={c.id} className="text-sm">
                    <p className="font-medium">&quot;{c.name}&quot; already covers this range:</p>
                    <p className="rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground" style={{ background: "var(--card)" }}>
                      {describeScope(c, categories, departments, costCenters)} → {describeSteps(reqs, roles)}
                    </p>
                  </div>
                );
              })}
              <div className={cn("grid gap-2", ruleType === "auto_approve" ? "grid-cols-1" : "grid-cols-2")}>
                <button
                  type="button"
                  onClick={() => setConflictChoice("replace")}
                  className="rounded-md border p-3 text-left"
                  style={{ background: "var(--card)", borderColor: conflictChoice === "replace" ? "var(--primary)" : "var(--border)" }}
                >
                  <p className="text-sm font-medium">Replace it for this range</p>
                  <p className="text-xs text-muted-foreground">Only this new rule applies here — the older rule steps aside for this range.</p>
                </button>
                {ruleType === "requires_approval" && (
                  <button
                    type="button"
                    onClick={() => setConflictChoice("alongside")}
                    className="rounded-md border p-3 text-left"
                    style={{ background: "var(--card)", borderColor: conflictChoice === "alongside" ? "var(--primary)" : "var(--border)" }}
                  >
                    <p className="text-sm font-medium">Apply alongside it</p>
                    <p className="text-xs text-muted-foreground">Both rules apply — this purchase needs every approval either rule asks for.</p>
                  </button>
                )}
              </div>
              {ruleType === "auto_approve" && (
                <p className="text-xs text-muted-foreground">
                  Auto-approve can only replace an overlapping rule, not apply alongside it — combining
                  &quot;no review needed&quot; with another rule&apos;s approvers would contradict itself.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {wizStep === 4 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium">&quot;{name}&quot;</p>
          <div className="rounded-md border p-4">
            <p className="text-sm">
              {describeScope(scope, categories, departments, costCenters)}:
            </p>
            <div className="mt-2.5 flex flex-col gap-1.5 border-t pt-2.5">
              {ruleType === "auto_approve" ? (
                <p className="text-sm">Auto-approve — no review needed. Submitting goes straight to sourcing.</p>
              ) : (
                activeSteps.map((s, i) => (
                  <p key={s.key} className="text-sm">
                    <span className="mr-1.5 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold" style={{ background: "var(--accent)", color: "var(--primary)" }}>STEP {i + 1}</span>
                    {describeSteps(s.roles.map((r) => ({ groupNo: 1, approverRoleId: r.approverRoleId, minApprovalsInGroup: r.minApprovalsInGroup })), roles)}
                  </p>
                ))
              )}
            </div>
            {hasConflicts && (
              <p className="mt-2.5 border-t pt-2.5 text-xs text-muted-foreground">
                {combinationMode === "exclusive" ? `Replaces ${conflicts.map((c) => `"${c.name}"`).join(", ")} for this range` : `Applies alongside ${conflicts.map((c) => `"${c.name}"`).join(", ")}`} · priority {priority}
              </p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Preview:{" "}
            <Badge variant="neutral">
              {ruleType === "auto_approve" ? "Auto-approved" : `${reviewRequirements.length} approval${reviewRequirements.length === 1 ? "" : "s"} required`}
            </Badge>
          </p>
        </div>
      )}

      <div className="flex items-center justify-between border-t pt-3">
        <button
          type="button"
          onClick={() => {
            if (wizStep === 1) {
              setOpen(false);
              resetWizard();
            } else {
              setWizStep((s) => s - 1);
            }
          }}
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          {wizStep === 1 ? "Cancel" : "← Back"}
        </button>
        {wizStep < TOTAL_STEPS ? (
          <button
            type="button"
            disabled={(wizStep === 1 && !name.trim()) || (wizStep === 2 && !step2Valid) || (wizStep === 3 && !step3Valid)}
            onClick={() => setWizStep((s) => s + 1)}
            className={cn(buttonVariants(), "disabled:opacity-40")}
          >
            Next →
          </button>
        ) : (
          <button type="button" disabled={saving} onClick={handleSave} className={cn(buttonVariants(), "disabled:opacity-40")}>
            {saving ? "Saving…" : "Save rule"}
          </button>
        )}
      </div>
    </div>
  );
}
