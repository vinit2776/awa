// Turns a rule's raw fields (category/department/cost-center/value
// range, and its requirement rows) into one plain sentence — used both
// for the saved-rules list and the wizard's own live review step, so
// "what this rule does" always reads the same way regardless of where
// it's shown.

type NamedRef = { id: string; name: string };
type RoleRef = { id: string; displayName: string };

export type ScopeInput = {
  categoryId: string | null;
  departmentId: string | null;
  costCenterId: string | null;
  minValue: string;
  maxValue: string | null;
  currency: string;
};

export type RequirementInput = {
  groupNo: number;
  approverRoleId: string;
  minApprovalsInGroup: number;
};

export function describeScope(
  scope: ScopeInput,
  categories: NamedRef[],
  departments: NamedRef[],
  costCenters: NamedRef[],
): string {
  const cat = categories.find((c) => c.id === scope.categoryId)?.name ?? null;
  const dept = departments.find((d) => d.id === scope.departmentId)?.name ?? null;
  const cc = costCenters.find((c) => c.id === scope.costCenterId)?.name ?? null;

  const min = Number(scope.minValue || 0);
  const max = scope.maxValue ? Number(scope.maxValue) : null;
  const hasRange = min > 0 || max !== null;

  const head = cat ? `Any ${cat} purchase` : "Any purchase";
  const scopeParts = [dept && `from ${dept}`, cc && `billed to ${cc}`].filter(Boolean) as string[];
  const scopeSentence = scopeParts.length ? `${head} ${scopeParts.join(", ")}` : head;

  const money = (n: number) => `${scope.currency} ${n.toLocaleString("en-IN")}`;
  const amount = hasRange ? `between ${money(min)} and ${max !== null ? money(max) : "no limit"}` : "any amount";

  return `${scopeSentence}, ${amount}`;
}

export function describeSteps(requirements: RequirementInput[], roles: RoleRef[]): string {
  if (requirements.length === 0) return "no approval required";

  const roleName = (id: string) => roles.find((r) => r.id === id)?.displayName ?? "someone";
  const byGroup = new Map<number, RequirementInput[]>();
  for (const req of requirements) {
    if (!byGroup.has(req.groupNo)) byGroup.set(req.groupNo, []);
    byGroup.get(req.groupNo)!.push(req);
  }

  const stepSentences = [...byGroup.keys()].sort((a, b) => a - b).map((groupNo) => {
    const reqs = byGroup.get(groupNo)!;
    const parts = reqs.map((r) => `${roleName(r.approverRoleId)}${r.minApprovalsInGroup > 1 ? ` (×${r.minApprovalsInGroup})` : ""}`);
    const verb = parts.length === 1 ? "approves" : "approve";
    return `${parts.join(" and ")} ${verb}`;
  });

  return stepSentences.join(", then ");
}

export function describeRule(
  scope: ScopeInput,
  requirements: RequirementInput[],
  categories: NamedRef[],
  departments: NamedRef[],
  costCenters: NamedRef[],
  roles: RoleRef[],
): string {
  return `${describeScope(scope, categories, departments, costCenters)} → ${describeSteps(requirements, roles)}.`;
}
