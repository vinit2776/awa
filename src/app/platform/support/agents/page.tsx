import Link from "next/link";
import { redirect } from "next/navigation";
import { PlatformAdminAccessError } from "@/db/platformSession";
import { getCurrentSupportAgent } from "@/db/supportDesk";
import { listAgentRoster } from "@/db/supportRouting";
import { db } from "@/db/client";
import { tenants as tenantsTable } from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { addAgentAction, toggleAgentActive, updateRouting } from "./actions";

const TYPES = [
  { value: "bug", label: "Bug" },
  { value: "feature_request", label: "Feature" },
  { value: "feedback", label: "Feedback" },
  { value: "question", label: "Question" },
];

export default async function SupportAgentsPage() {
  try {
    await getCurrentSupportAgent();
  } catch (error) {
    if (error instanceof PlatformAdminAccessError) redirect("/platform");
    throw error;
  }

  const [{ roster, unrostered }, tenants] = await Promise.all([
    listAgentRoster(),
    // tenants carries no tenant_id — it's the root entity, not tenant-scoped
    // data — so this reads on the ordinary connection with no scope set.
    db.select({ id: tenantsTable.id, name: tenantsTable.name }).from(tenantsTable).orderBy(tenantsTable.name),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-5 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/platform/support" className="text-xs text-muted-foreground hover:text-foreground">
            ← Support queue
          </Link>
          <h1 className="mt-1 font-serif text-xl">Agent roster</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Who new tickets route to. An account owner takes their customers&apos; tickets outright; everyone else
            shares the load, least-loaded first.
          </p>
        </div>
      </div>

      {roster.length === 0 ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-sm">
          <p className="font-medium">Nobody is on the roster.</p>
          <p className="mt-1 text-muted-foreground">
            Every new ticket will arrive unassigned and email the super admins. Add someone below.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {roster.map(({ agent, admin, openCount }) => (
            <form
              key={agent.id}
              action={updateRouting}
              className={cn(
                "flex flex-col gap-4 rounded-lg border p-4",
                agent.active ? "border-border bg-card" : "border-border bg-background opacity-70",
              )}
            >
              <input type="hidden" name="agentId" value={agent.id} />

              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <p className="text-sm font-medium">{admin.fullName}</p>
                  <p className="text-xs text-muted-foreground">
                    {admin.email} · {admin.role}
                  </p>
                </div>
                <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs tabular-nums">
                  {openCount} open
                </span>
                {!agent.active && (
                  <span className="rounded-full border border-input px-2.5 py-0.5 text-xs text-muted-foreground">
                    Inactive — never routed to
                  </span>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <fieldset className="flex flex-col gap-1.5">
                  <legend className="mb-1 text-xs font-medium text-muted-foreground">
                    Handles — none ticked means all
                  </legend>
                  {TYPES.map((t) => (
                    <label key={t.value} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        name="handlesTypes"
                        value={t.value}
                        defaultChecked={agent.handlesTypes.includes(t.value as (typeof agent.handlesTypes)[number])}
                      />
                      {t.label}
                    </label>
                  ))}
                </fieldset>

                <fieldset className="flex flex-col gap-1.5">
                  <legend className="mb-1 text-xs font-medium text-muted-foreground">
                    Account owner for — none ticked means all
                  </legend>
                  <div className="flex max-h-32 flex-col gap-1.5 overflow-y-auto">
                    {tenants.map((t) => (
                      <label key={t.id} className="flex items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          name="coversTenantIds"
                          value={t.id}
                          defaultChecked={agent.coversTenantIds.includes(t.id)}
                        />
                        {t.name}
                      </label>
                    ))}
                  </div>
                </fieldset>

                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Max open — blank means no cap</span>
                  <input
                    name="maxOpen"
                    type="number"
                    min={1}
                    defaultValue={agent.maxOpen ?? ""}
                    className="w-28 rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
                  />
                  <span className="text-xs text-muted-foreground">
                    At the cap, tickets stay unassigned rather than being pushed on.
                  </span>
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                <button type="submit" className={cn(buttonVariants({ size: "sm" }))}>
                  Save routing
                </button>
                <span className="ml-auto" />
                <button
                  type="submit"
                  formAction={toggleAgentActive}
                  name="active"
                  value={agent.active ? "false" : "true"}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                >
                  {agent.active ? "Deactivate" : "Reactivate"}
                </button>
              </div>
            </form>
          ))}
        </div>
      )}

      {unrostered.length > 0 && (
        <form action={addAgentAction} className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Add a platform admin to the roster</span>
            <select
              name="platformAdminId"
              required
              className="rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
            >
              {unrostered.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.fullName} ({a.role})
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={cn(buttonVariants({ size: "sm" }))}>
            Add
          </button>
        </form>
      )}
    </div>
  );
}
