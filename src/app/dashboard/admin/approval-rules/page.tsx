import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import {
  approvalRules as approvalRulesTable,
  approvalRuleRequirements as approvalRuleRequirementsTable,
  catalogCategories as catalogCategoriesTable,
  departments as departmentsTable,
  costCenters as costCentersTable,
  roles as rolesTable,
} from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { cn } from "@/lib/utils";
import { describeRule } from "./describeRule";
import { RuleWizard } from "./RuleWizard";
import { toggleRuleActive, updateEscalationSla } from "./actions";

export default async function ApprovalRulesPage() {
  const { tenant } = await getCurrentUserAndTenant();

  const [rules, requirements, categories, departments, costCenters, roles] = await withTenant(
    tenant.id,
    async (tx) => [
      await tx.select().from(approvalRulesTable),
      await tx.select().from(approvalRuleRequirementsTable),
      await tx.select().from(catalogCategoriesTable),
      await tx.select().from(departmentsTable),
      await tx.select().from(costCentersTable),
      await tx.select().from(rolesTable),
    ],
  );

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-2">
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Admin", href: "/dashboard/admin/departments" },
            { label: "Approval rules" },
          ]}
        />
        <div>
          <h1 className="font-serif text-lg text-foreground">Approval rules</h1>
          <p className="text-sm text-muted-foreground">{rules.length} rules in {tenant.name}</p>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Escalation</h2>
        <form action={updateEscalationSla} className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Escalate a pending approval after (hours)</label>
            <input
              name="escalationSlaHours"
              type="number"
              min="0"
              defaultValue={tenant.escalationSlaHours}
              className="h-8 w-24 rounded-md border px-2 text-sm"
            />
          </div>
          <button type="submit" className={cn(buttonVariants({ variant: "outline" }))}>Save</button>
          <p className="text-xs text-muted-foreground">
            {tenant.escalationSlaHours > 0
              ? `Tenant admins are notified once an approval has been actionable for more than ${tenant.escalationSlaHours} hours. 0 disables this.`
              : "Escalation is off for this tenant — set a value above 0 to enable it."}
          </p>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">Rules</h2>
          <RuleWizard categories={categories} departments={departments} costCenters={costCenters} roles={roles} existingRules={rules} existingRequirements={requirements} />
        </div>

        <div className="flex flex-col gap-2">
          {rules.length === 0 && <p className="text-sm text-muted-foreground">No approval rules yet.</p>}
          {rules.map((r) => {
            const reqsForRule = requirements.filter((req) => req.ruleId === r.id);
            return (
              <div key={r.id} className="flex flex-col gap-2 rounded-md border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-foreground">{describeRule(r, reqsForRule, categories, departments, costCenters, roles)}</p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <Badge variant={r.active ? "success" : "neutral"}>{r.active ? "Active" : "Inactive"}</Badge>
                      <details className="text-xs text-muted-foreground">
                        <summary className="cursor-pointer">Details</summary>
                        <p className="mt-1 font-mono">
                          category: {r.categoryId ?? "any"} · department: {r.departmentId ?? "any"} · cost_center: {r.costCenterId ?? "any"} ·
                          {" "}min_value: {r.minValue} · max_value: {r.maxValue ?? "null"} · combination_mode: {r.combinationMode} · priority: {r.priority}
                        </p>
                        {reqsForRule.length > 0 && (
                          <ul className="mt-1 flex flex-col gap-0.5 font-mono">
                            {reqsForRule.map((req) => (
                              <li key={req.approverRoleId + req.groupNo}>
                                group {req.groupNo}: {roles.find((role) => role.id === req.approverRoleId)?.displayName ?? req.approverRoleId}
                                {req.minApprovalsInGroup > 1 ? ` (×${req.minApprovalsInGroup})` : ""}
                              </li>
                            ))}
                          </ul>
                        )}
                      </details>
                    </div>
                  </div>
                  <form action={toggleRuleActive} className="shrink-0">
                    <input type="hidden" name="ruleId" value={r.id} />
                    <input type="hidden" name="active" value={(!r.active).toString()} />
                    <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                      {r.active ? "Deactivate" : "Activate"}
                    </button>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
