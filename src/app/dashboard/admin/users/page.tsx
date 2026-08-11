import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { inviteUser, setUserStatus, assignUserRole } from "@/db/userInvite";
import {
  users as usersTable,
  roles as rolesTable,
  userRoles as userRolesTable,
  departments as departmentsTable,
  costCenters as costCentersTable,
} from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

async function inviteUserAction(formData: FormData) {
  "use server";
  const { user: actor, tenant } = await getCurrentUserAndTenant();
  const email = String(formData.get("email") ?? "");
  const fullName = String(formData.get("fullName") ?? "");

  const result = await withTenant(tenant.id, (tx) => inviteUser(tx, tenant.id, actor.id, { email, fullName }));
  if (result.error) {
    redirect(`/dashboard/admin/users?error=${encodeURIComponent(result.error)}`);
  }

  revalidatePath("/dashboard/admin/users");
}

async function toggleUserStatusAction(formData: FormData) {
  "use server";
  const { user: actor, tenant } = await getCurrentUserAndTenant();
  const userId = String(formData.get("userId") ?? "");
  const status = String(formData.get("status") ?? "") as "active" | "disabled";
  if (!userId || !status) return;

  await withTenant(tenant.id, (tx) => setUserStatus(tx, tenant.id, actor.id, userId, status));
  revalidatePath("/dashboard/admin/users");
}

async function assignRole(formData: FormData) {
  "use server";
  const { user: actor, tenant } = await getCurrentUserAndTenant();
  const userId = String(formData.get("userId") ?? "");
  const roleId = String(formData.get("roleId") ?? "");
  const scopeType = String(formData.get("scopeType") ?? "global") as "global" | "department" | "cost_center";
  const scopeId = scopeType === "global" ? null : String(formData.get("scopeId") ?? "") || null;
  if (!userId || !roleId) return;

  const result = await withTenant(tenant.id, (tx) => assignUserRole(tx, tenant.id, actor.id, { userId, roleId, scopeType, scopeId }));
  if (result.error) {
    redirect(`/dashboard/admin/users?error=${encodeURIComponent(result.error)}`);
  }

  revalidatePath("/dashboard/admin/users");
}

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const { tenant } = await getCurrentUserAndTenant();

  const [tenantUsers, roles, departments, costCenters, assignments] = await withTenant(
    tenant.id,
    async (tx) => [
      await tx.select().from(usersTable),
      await tx.select().from(rolesTable),
      await tx.select().from(departmentsTable),
      await tx.select().from(costCentersTable),
      await tx.select().from(userRolesTable).where(eq(userRolesTable.tenantId, tenant.id)),
    ],
  );

  const nameFor = {
    user: (id: string) => tenantUsers.find((u) => u.id === id)?.fullName ?? id,
    role: (id: string) => roles.find((r) => r.id === id)?.displayName ?? id,
    scope: (type: string, id: string | null) => {
      if (type === "global" || !id) return "Global";
      if (type === "department") return departments.find((d) => d.id === id)?.name ?? id;
      return costCenters.find((c) => c.id === id)?.name ?? id;
    },
  };

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="font-serif text-lg text-foreground">Users</h1>
        <p className="text-sm text-muted-foreground">{tenantUsers.length} in {tenant.name}</p>
      </div>

      <section className="flex flex-col gap-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 font-normal">Name</th>
              <th className="py-2 font-normal">Email</th>
              <th className="py-2 font-normal">Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tenantUsers.map((u) => (
              <tr key={u.id} className="border-b">
                <td className="py-2">{u.fullName}</td>
                <td className="py-2 text-muted-foreground">{u.email}</td>
                <td className="py-2">{u.status}</td>
                <td className="py-2">
                  {u.status === "disabled" ? (
                    <form action={toggleUserStatusAction}>
                      <input type="hidden" name="userId" value={u.id} />
                      <input type="hidden" name="status" value="active" />
                      <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                        Re-enable
                      </button>
                    </form>
                  ) : (
                    <form action={toggleUserStatusAction}>
                      <input type="hidden" name="userId" value={u.id} />
                      <input type="hidden" name="status" value="disabled" />
                      <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                        Disable
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <form action={inviteUserAction} className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="fullName" className="text-xs text-muted-foreground">Name</label>
            <input id="fullName" name="fullName" required className="h-8 rounded-md border px-2 text-sm" placeholder="Jane Doe" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="email" className="text-xs text-muted-foreground">Email</label>
            <input id="email" name="email" type="email" required className="h-8 rounded-md border px-2 text-sm" placeholder="jane@company.com" />
          </div>
          <button type="submit" className={cn(buttonVariants())}>Invite</button>
        </form>
        <p className="text-xs text-muted-foreground max-w-xl">
          Invited users show as &quot;invited&quot; until they sign in via WorkOS with this exact email — there&apos;s no
          self-serve signup, this is what makes them eligible to.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Role assignment</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 font-normal">User</th>
              <th className="py-2 font-normal">Role</th>
              <th className="py-2 font-normal">Scope</th>
            </tr>
          </thead>
          <tbody>
            {assignments.map((a) => (
              <tr key={a.id} className="border-b">
                <td className="py-2">{nameFor.user(a.userId)}</td>
                <td className="py-2">{nameFor.role(a.roleId)}</td>
                <td className="py-2">{nameFor.scope(a.scopeType, a.scopeId)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <form action={assignRole} className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="userId" className="text-xs text-muted-foreground">User</label>
            <select id="userId" name="userId" required className="h-8 rounded-md border px-2 text-sm">
              {tenantUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.fullName} ({u.email})</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="roleId" className="text-xs text-muted-foreground">Role</label>
            <select id="roleId" name="roleId" required className="h-8 rounded-md border px-2 text-sm">
              {roles.map((r) => (
                <option key={r.id} value={r.id}>{r.displayName}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="scopeType" className="text-xs text-muted-foreground">Scope</label>
            <select id="scopeType" name="scopeType" required className="h-8 rounded-md border px-2 text-sm">
              <option value="global">Global</option>
              <option value="department">Department</option>
              <option value="cost_center">Cost center</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="scopeId" className="text-xs text-muted-foreground">Scope target (if not global)</label>
            <select id="scopeId" name="scopeId" className="h-8 rounded-md border px-2 text-sm">
              <option value="">—</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>Dept: {d.name}</option>
              ))}
              {costCenters.map((c) => (
                <option key={c.id} value={c.id}>Cost center: {c.name}</option>
              ))}
            </select>
          </div>
          <button type="submit" className={cn(buttonVariants())}>Assign</button>
        </form>
      </section>
    </div>
  );
}
