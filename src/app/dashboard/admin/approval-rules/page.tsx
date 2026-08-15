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
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { cn } from "@/lib/utils";
import { createRule, createRuleRequirement, toggleRuleActive, updateEscalationSla } from "./actions";

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

  const nameFor = {
    category: (id: string | null) => categories.find((c) => c.id === id)?.name ?? "Any",
    department: (id: string | null) => departments.find((d) => d.id === id)?.name ?? "Any",
    costCenter: (id: string | null) => costCenters.find((c) => c.id === id)?.name ?? "Any",
    role: (id: string) => roles.find((r) => r.id === id)?.displayName ?? id,
  };

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
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 font-normal">Name</th>
              <th className="py-2 font-normal">Category</th>
              <th className="py-2 font-normal">Department</th>
              <th className="py-2 font-normal">Cost center</th>
              <th className="py-2 font-normal">Value range</th>
              <th className="py-2 font-normal">Mode</th>
              <th className="py-2 font-normal">Priority</th>
              <th className="py-2 font-normal">Requirements</th>
              <th className="py-2 font-normal">Active</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} className="border-b align-top">
                <td className="py-2">{r.name}</td>
                <td className="py-2">{nameFor.category(r.categoryId)}</td>
                <td className="py-2">{nameFor.department(r.departmentId)}</td>
                <td className="py-2">{nameFor.costCenter(r.costCenterId)}</td>
                <td className="py-2">{r.minValue} – {r.maxValue ?? "∞"} {r.currency}</td>
                <td className="py-2">{r.combinationMode}</td>
                <td className="py-2">{r.priority}</td>
                <td className="py-2">
                  <ul className="flex flex-col gap-0.5">
                    {requirements
                      .filter((req) => req.ruleId === r.id)
                      .map((req) => (
                        <li key={req.id} className="text-xs text-muted-foreground">
                          Group {req.groupNo}: {nameFor.role(req.approverRoleId)}
                          {req.minApprovalsInGroup > 1 ? ` (×${req.minApprovalsInGroup})` : ""}
                        </li>
                      ))}
                  </ul>
                </td>
                <td className="py-2">
                  <form action={toggleRuleActive}>
                    <input type="hidden" name="ruleId" value={r.id} />
                    <input type="hidden" name="active" value={(!r.active).toString()} />
                    <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                      {r.active ? "Deactivate" : "Activate"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">New rule</h2>
        <form action={createRule} className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Name</label>
            <input name="name" required className="h-8 rounded-md border px-2 text-sm" placeholder="e.g. IT assets" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Category</label>
            <select name="categoryId" className="h-8 rounded-md border px-2 text-sm">
              <option value="">Any</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Department</label>
            <select name="departmentId" className="h-8 rounded-md border px-2 text-sm">
              <option value="">Any</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Cost center</label>
            <select name="costCenterId" className="h-8 rounded-md border px-2 text-sm">
              <option value="">Any</option>
              {costCenters.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Min value</label>
            <input name="minValue" type="number" step="0.01" defaultValue="0" className="h-8 w-24 rounded-md border px-2 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Max value</label>
            <input name="maxValue" type="number" step="0.01" placeholder="no limit" className="h-8 w-24 rounded-md border px-2 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Mode</label>
            <select name="combinationMode" className="h-8 rounded-md border px-2 text-sm">
              <option value="additive">Additive</option>
              <option value="exclusive">Exclusive</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Priority</label>
            <input name="priority" type="number" defaultValue="0" className="h-8 w-16 rounded-md border px-2 text-sm" />
          </div>
          <button type="submit" className={cn(buttonVariants())}>Add rule</button>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">New requirement</h2>
        <form action={createRuleRequirement} className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Rule</label>
            <select name="ruleId" required className="h-8 rounded-md border px-2 text-sm">
              {rules.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Approver role</label>
            <select name="approverRoleId" required className="h-8 rounded-md border px-2 text-sm">
              {roles.map((r) => (
                <option key={r.id} value={r.id}>{r.displayName}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Group</label>
            <input name="groupNo" type="number" defaultValue="1" min="1" className="h-8 w-16 rounded-md border px-2 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Min approvals in group</label>
            <input name="minApprovalsInGroup" type="number" defaultValue="1" min="1" className="h-8 w-16 rounded-md border px-2 text-sm" />
          </div>
          <button type="submit" className={cn(buttonVariants())}>Add requirement</button>
        </form>
        <p className="text-xs text-muted-foreground max-w-2xl">
          Requirements in the same group act in parallel; lower-numbered groups gate later ones — a PR only
          reaches group 2 once every requirement in group 1 has approved.
        </p>
      </section>
    </div>
  );
}
