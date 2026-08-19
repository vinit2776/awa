import Link from "next/link";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import {
  departments as departmentsTable,
  costCenters as costCentersTable,
  roles as rolesTable,
  users as usersTable,
  userRoles as userRolesTable,
  approvalRules as approvalRulesTable,
  vendors as vendorsTable,
  catalogItems as catalogItemsTable,
} from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Info, Term } from "@/components/ui/help";
import { cn } from "@/lib/utils";

/**
 * Setup, in the order the dependencies actually run.
 *
 * /dashboard/admin had no page at all — the sidebar linked past it
 * straight to /departments — so the nine admin screens arrived as a flat
 * alphabetical-ish list that implied they were independent. They are
 * not: an approval rule needs roles to route to, a rule scoped to a
 * department needs departments, and a requisition cannot be charged
 * anywhere without a cost centre. A new admin had no way to learn that
 * order except by hitting the failures.
 *
 * The fifth step is the one that matters most. With no approval rules,
 * resolveApprovals finds nobody to route to and approves outright rather
 * than deadlocking — correct engineering, and a tenant can run for weeks
 * believing it has controls it does not have. Today shows the same
 * warning; this is where it gets fixed.
 */
export default async function AdminSetupPage() {
  const { tenant } = await getCurrentUserAndTenant();

  const data = await withTenant(tenant.id, async (tx) => ({
    departments: await tx.select().from(departmentsTable),
    costCenters: await tx.select().from(costCentersTable),
    roles: await tx.select().from(rolesTable),
    users: await tx.select().from(usersTable),
    userRoles: await tx.select().from(userRolesTable),
    approvalRules: await tx.select().from(approvalRulesTable),
    vendors: await tx.select().from(vendorsTable),
    catalogItems: await tx.select().from(catalogItemsTable),
  }));

  const budgetedCostCentres = data.costCenters.filter((c) => c.annualBudget !== null);
  const activeRules = data.approvalRules.filter((r) => r.active);
  const usersWithARole = new Set(data.userRoles.map((r) => r.userId));
  const usersWithoutARole = data.users.filter((u) => !usersWithARole.has(u.id));

  const steps = [
    {
      key: "departments",
      title: "Departments",
      href: "/dashboard/admin/departments",
      done: data.departments.length > 0,
      detail: data.departments.length
        ? `${data.departments.length} set up — ${data.departments.slice(0, 3).map((d) => d.name).join(", ")}${data.departments.length > 3 ? "…" : ""}`
        : "The parts of the organisation that raise requisitions. Approval rules can route on them, so these come first.",
    },
    {
      key: "cost-centres",
      title: "Cost centres and budgets",
      href: "/dashboard/admin/cost-centers",
      done: data.costCenters.length > 0 && budgetedCostCentres.length === data.costCenters.length,
      detail: data.costCenters.length === 0
        ? "The budget lines spend is charged against. Nothing can be requested until at least one exists."
        : budgetedCostCentres.length < data.costCenters.length
          ? `${data.costCenters.length} set up, but ${data.costCenters.length - budgetedCostCentres.length} without an annual budget — requesters get no budget warning on those.`
          : `${data.costCenters.length} set up, all with an annual budget.`,
    },
    {
      key: "roles",
      title: "Roles",
      href: "/dashboard/admin/roles",
      done: data.roles.length > 0,
      detail: data.roles.length
        ? `${data.roles.length} in place. Rename them to match what your organisation actually calls these people — the underlying keys don't change.`
        : "Seed the six defaults — requestor, department head, procurement officer, finance approver, CFO, tenant admin. Approval rules route to roles, so nothing downstream works without them.",
    },
    {
      key: "people",
      title: "People, and what each of them can do",
      href: "/dashboard/admin/users",
      done: data.users.length > 1 && usersWithoutARole.length === 0,
      detail: usersWithoutARole.length > 0
        ? `${data.users.length} invited, but ${usersWithoutARole.length} ${usersWithoutARole.length === 1 ? "has" : "have"} no role yet. Somebody with no role can raise requisitions and nothing else.`
        : `${data.users.length} invited, all with at least one role.`,
    },
    {
      key: "rules",
      title: "Approval rules",
      href: "/dashboard/admin/approval-rules",
      done: activeRules.length > 0,
      detail: activeRules.length
        ? `${activeRules.length} active. Each says who must sign off, at what value, for which category or department.`
        : null, // Rendered as the warning below instead — a bullet undersells it.
    },
    {
      key: "vendors",
      title: "Vendors and catalogue",
      href: "/dashboard/admin/vendors",
      done: data.vendors.length > 0,
      optional: true,
      detail: data.vendors.length
        ? `${data.vendors.length} ${data.vendors.length === 1 ? "vendor" : "vendors"}, ${data.catalogItems.length} catalogue ${data.catalogItems.length === 1 ? "item" : "items"}.`
        : "Speeds things up and prevents duplicate items, but people can type free-text items from day one. Safe to skip and come back to.",
    },
  ];

  const required = steps.filter((s) => !s.optional);
  const doneCount = required.filter((s) => s.done).length;
  const currentKey = steps.find((s) => !s.done && !s.optional)?.key;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-lg text-foreground">Set up {tenant.name}</h1>
          <p className="text-sm text-muted-foreground">
            Five steps, in this order — each one depends on the one above it. Everything stays editable
            afterwards.
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xl font-medium tabular-nums">
            {doneCount} / {required.length}
          </p>
          <p className="text-xs text-muted-foreground">
            {doneCount === required.length
              ? "ready to go"
              : `${required.length - doneCount} left before you're live`}
          </p>
        </div>
      </div>

      {activeRules.length === 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3.5 py-3">
          <span className="w-[3px] self-stretch rounded-sm bg-destructive" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">Nothing is being approved by anyone yet</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {tenant.name} has no active <Term name="approval-rule" sentenceCase />, so every requisition anyone
              submits is approved automatically the moment it is sent — no one reviews it.
              <Info
                title="Why it auto-approves"
                next="One rule — say, anything over 0 needs a department head — closes the gap."
              >
                When no rule matches a requisition there is nobody to route it to, so AWA approves it rather than
                leaving it stuck forever. That stops a half-configured tenant deadlocking, but it means the
                controls you bought are not running yet.
              </Info>
            </p>
          </div>
        </div>
      )}

      <ol className="flex flex-col rounded-lg border border-border">
        {steps.map((step, index) => {
          const isCurrent = step.key === currentKey;
          return (
            <li
              key={step.key}
              className={cn(
                "flex items-start gap-3 px-4 py-3.5",
                index > 0 && "border-t border-border",
                isCurrent && "bg-primary/5",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 grid size-4 shrink-0 place-items-center rounded-[5px] border text-[9px] font-bold",
                  step.done
                    ? "border-success bg-success text-success-foreground"
                    : isCurrent
                      ? "border-primary text-transparent"
                      : "border-input text-transparent",
                )}
              >
                ✓
              </span>

              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className={cn("text-sm", step.done ? "text-muted-foreground" : "font-medium text-foreground")}>
                    {step.title}
                  </p>
                  {isCurrent && <Badge variant="warning">You&apos;re here</Badge>}
                  {step.optional && <Badge>Optional</Badge>}
                </div>
                {step.detail && <p className="mt-0.5 text-xs text-muted-foreground">{step.detail}</p>}
                {step.key === "rules" && activeRules.length === 0 && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Who must sign off, at what value, for which category or department. Until one exists, nothing
                    is reviewed.
                  </p>
                )}
              </div>

              <Link
                href={step.href}
                className={cn(
                  buttonVariants({ variant: step.done ? "outline" : "default", size: "sm" }),
                  "shrink-0",
                )}
              >
                {step.done ? "Review" : "Set up"}
              </Link>
            </li>
          );
        })}
      </ol>

      <p className="text-xs text-muted-foreground">
        Every action on these screens is written to the{" "}
        <Link href="/dashboard/admin/audit" className="underline underline-offset-2">
          audit log
        </Link>
        , including who did it and when.
      </p>
    </div>
  );
}
