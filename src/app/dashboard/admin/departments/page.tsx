import { revalidatePath } from "next/cache";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { logAction } from "@/db/audit";
import { departments as departmentsTable, costCenters as costCentersTable } from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

async function createDepartment(formData: FormData) {
  "use server";
  const { user, tenant } = await getCurrentUserAndTenant();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  await withTenant(tenant.id, async (tx) => {
    const [created] = await tx
      .insert(departmentsTable)
      .values({ tenantId: tenant.id, name })
      .returning();
    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "department.created",
      entityType: "department",
      entityId: created.id,
      metadata: { name },
    });
  });

  revalidatePath("/dashboard/admin/departments");
}

export default async function DepartmentsPage() {
  const { tenant } = await getCurrentUserAndTenant();

  const [departments, costCenters] = await withTenant(tenant.id, async (tx) => [
    await tx.select().from(departmentsTable),
    await tx.select().from(costCentersTable),
  ]);

  const costCenterName = (id: string | null) => costCenters.find((c) => c.id === id)?.name ?? "—";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-medium">Departments</h1>
        <p className="text-sm text-muted-foreground">{departments.length} in {tenant.name}</p>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 font-normal">Name</th>
            <th className="py-2 font-normal">Default cost center</th>
          </tr>
        </thead>
        <tbody>
          {departments.map((d) => (
            <tr key={d.id} className="border-b">
              <td className="py-2">{d.name}</td>
              <td className="py-2">{costCenterName(d.defaultCostCenterId)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <form action={createDepartment} className="flex items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="name" className="text-xs text-muted-foreground">New department</label>
          <input
            id="name"
            name="name"
            required
            className="h-8 rounded-md border px-2 text-sm"
            placeholder="e.g. Drilling operations"
          />
        </div>
        <button type="submit" className={cn(buttonVariants())}>Add</button>
      </form>
    </div>
  );
}
