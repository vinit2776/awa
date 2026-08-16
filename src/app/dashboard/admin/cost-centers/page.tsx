import { revalidatePath } from "next/cache";
import { getCurrentUserAndTenant } from "@/db/session";
import { requireTenantAdmin } from "@/db/permissions";
import { withTenant } from "@/db/withTenant";
import { logAction } from "@/db/audit";
import { costCenters as costCentersTable } from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { cn } from "@/lib/utils";

async function createCostCenter(formData: FormData) {
  "use server";
  const { user, tenant } = await requireTenantAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim();
  const annualBudget = String(formData.get("annualBudget") ?? "").trim() || null;
  if (!name || !code) return;

  await withTenant(tenant.id, async (tx) => {
    const [created] = await tx
      .insert(costCentersTable)
      .values({ tenantId: tenant.id, name, code, annualBudget })
      .returning();
    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "cost_center.created",
      entityType: "cost_center",
      entityId: created.id,
      metadata: { name, code },
    });
  });

  revalidatePath("/dashboard/admin/cost-centers");
}

export default async function CostCentersPage() {
  const { tenant } = await getCurrentUserAndTenant();
  const costCenters = await withTenant(tenant.id, (tx) => tx.select().from(costCentersTable));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Admin", href: "/dashboard/admin/departments" },
            { label: "Cost centers" },
          ]}
        />
        <div>
          <h1 className="font-serif text-lg text-foreground">Cost centers</h1>
          <p className="text-sm text-muted-foreground">{costCenters.length} in {tenant.name}</p>
        </div>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 font-normal">Name</th>
            <th className="py-2 font-normal">Code</th>
            <th className="py-2 font-normal">Currency</th>
            <th className="py-2 font-normal">Annual budget</th>
          </tr>
        </thead>
        <tbody>
          {costCenters.map((c) => (
            <tr key={c.id} className="border-b">
              <td className="py-2">{c.name}</td>
              <td className="py-2">{c.code}</td>
              <td className="py-2">{c.currency}</td>
              <td className="py-2">{c.annualBudget ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <form action={createCostCenter} className="flex items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="name" className="text-xs text-muted-foreground">Name</label>
          <input id="name" name="name" required className="h-8 rounded-md border px-2 text-sm" placeholder="e.g. Drilling ops — IT" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="code" className="text-xs text-muted-foreground">Code</label>
          <input id="code" name="code" required className="h-8 w-28 rounded-md border px-2 text-sm" placeholder="e.g. DR-IT" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="annualBudget" className="text-xs text-muted-foreground">Annual budget</label>
          <input
            id="annualBudget"
            name="annualBudget"
            type="number"
            step="0.01"
            className="h-8 w-32 rounded-md border px-2 text-sm"
            placeholder="optional"
          />
        </div>
        <button type="submit" className={cn(buttonVariants())}>Add</button>
      </form>
    </div>
  );
}
