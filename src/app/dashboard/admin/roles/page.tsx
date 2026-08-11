import { revalidatePath } from "next/cache";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { logAction } from "@/db/audit";
import { seedDefaultRoles } from "@/db/seedDefaultRoles";
import { roles as rolesTable } from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { cn } from "@/lib/utils";

async function seedDefaults() {
  "use server";
  const { user, tenant } = await getCurrentUserAndTenant();
  await withTenant(tenant.id, async (tx) => {
    await seedDefaultRoles(tx, tenant.id);
    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "roles.defaults_seeded",
      entityType: "tenant",
      entityId: tenant.id,
    });
  });
  revalidatePath("/dashboard/admin/roles");
}

async function createRole(formData: FormData) {
  "use server";
  const { user, tenant } = await getCurrentUserAndTenant();
  const displayName = String(formData.get("displayName") ?? "").trim();
  if (!displayName) return;
  const key = displayName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

  await withTenant(tenant.id, async (tx) => {
    const [created] = await tx
      .insert(rolesTable)
      .values({ tenantId: tenant.id, key, displayName, isSystem: false })
      .returning();
    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "role.created",
      entityType: "role",
      entityId: created.id,
      metadata: { displayName, key },
    });
  });

  revalidatePath("/dashboard/admin/roles");
}

export default async function RolesPage() {
  const { tenant } = await getCurrentUserAndTenant();
  const roles = await withTenant(tenant.id, (tx) => tx.select().from(rolesTable));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Admin", href: "/dashboard/admin/departments" },
            { label: "Roles" },
          ]}
        />
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-serif text-lg text-foreground">Roles</h1>
            <p className="text-sm text-muted-foreground">{roles.length} in {tenant.name}</p>
          </div>
          {roles.length === 0 && (
            <form action={seedDefaults}>
              <button type="submit" className={cn(buttonVariants({ variant: "outline" }))}>
                Seed default roles
              </button>
            </form>
          )}
        </div>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 font-normal">Display name</th>
            <th className="py-2 font-normal">Key</th>
            <th className="py-2 font-normal">System</th>
          </tr>
        </thead>
        <tbody>
          {roles.map((r) => (
            <tr key={r.id} className="border-b">
              <td className="py-2">{r.displayName}</td>
              <td className="py-2 font-mono text-xs text-muted-foreground">{r.key}</td>
              <td className="py-2">{r.isSystem ? "Yes" : "No"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <form action={createRole} className="flex items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="displayName" className="text-xs text-muted-foreground">New role</label>
          <input
            id="displayName"
            name="displayName"
            required
            className="h-8 rounded-md border px-2 text-sm"
            placeholder="e.g. Site safety officer"
          />
        </div>
        <button type="submit" className={cn(buttonVariants())}>Add</button>
      </form>
    </div>
  );
}
