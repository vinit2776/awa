import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { requireTenantAdmin } from "@/db/permissions";
import { withTenant } from "@/db/withTenant";
import { logAction } from "@/db/audit";
import { inviteUser, setUserStatus, assignUserRole } from "@/db/userInvite";
import { makeUserSetPasswordToken } from "@/db/userAuth";
import { getAppOrigin } from "@/lib/appOrigin";
import {
  users as usersTable,
  roles as rolesTable,
  userRoles as userRolesTable,
  departments as departmentsTable,
  costCenters as costCentersTable,
} from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { ListControls, ListFilter } from "@/components/ui/list-controls";
import { cn } from "@/lib/utils";

async function inviteUserAction(formData: FormData) {
  "use server";
  const { user: actor, tenant } = await requireTenantAdmin();
  const email = String(formData.get("email") ?? "");
  const fullName = String(formData.get("fullName") ?? "");

  const result = await withTenant(tenant.id, (tx) => inviteUser(tx, tenant.id, actor.id, { email, fullName }));
  if (result.error) {
    redirect(`/dashboard/admin/users?error=${encodeURIComponent(result.error)}`);
  }

  revalidatePath("/dashboard/admin/users");
  // Show the set-password link immediately — there's no email delivery
  // wired up (db/notifications.ts), so this is the only way the inviting
  // admin actually gets a link to hand to the new person.
  redirect(`/dashboard/admin/users?linkForUserId=${result.userId}`);
}

async function generateSetPasswordLinkAction(formData: FormData) {
  "use server";
  await getCurrentUserAndTenant();
  const userId = String(formData.get("userId") ?? "");
  if (!userId) return;
  redirect(`/dashboard/admin/users?linkForUserId=${encodeURIComponent(userId)}`);
}

async function toggleUserStatusAction(formData: FormData) {
  "use server";
  const { user: actor, tenant } = await requireTenantAdmin();
  const userId = String(formData.get("userId") ?? "");
  const status = String(formData.get("status") ?? "") as "active" | "disabled";
  if (!userId || !status) return;

  await withTenant(tenant.id, (tx) => setUserStatus(tx, tenant.id, actor.id, userId, status));
  revalidatePath("/dashboard/admin/users");
}

async function assignRole(formData: FormData) {
  "use server";
  const { user: actor, tenant } = await requireTenantAdmin();
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

async function revokeRole(formData: FormData) {
  "use server";
  const { user: actor, tenant } = await requireTenantAdmin();
  const assignmentId = String(formData.get("assignmentId") ?? "");
  if (!assignmentId) return;

  const [assignment] = await withTenant(tenant.id, (tx) =>
    tx
      .select()
      .from(userRolesTable)
      .where(and(eq(userRolesTable.id, assignmentId), eq(userRolesTable.tenantId, tenant.id))),
  );
  if (!assignment) return;

  const [role] = await withTenant(tenant.id, (tx) =>
    tx.select().from(rolesTable).where(eq(rolesTable.id, assignment.roleId)),
  );

  // Revoking the last tenant_admin assignment doesn't lock anyone out —
  // isTenantAdmin (db/permissions.ts) falls open to every tenant member
  // once nobody holds the role — but that's an unintended privilege
  // escalation if it happens by accident, not a safe default to fall
  // into silently. Block it; require assigning a replacement first.
  if (role?.key === "tenant_admin") {
    const admins = await withTenant(tenant.id, (tx) =>
      tx
        .select({ id: userRolesTable.id })
        .from(userRolesTable)
        .where(and(eq(userRolesTable.tenantId, tenant.id), eq(userRolesTable.roleId, assignment.roleId))),
    );
    if (admins.length <= 1) {
      redirect(
        `/dashboard/admin/users?error=${encodeURIComponent("Can't revoke the last Tenant admin — assign the role to someone else first.")}`,
      );
    }
  }

  await withTenant(tenant.id, async (tx) => {
    await tx.delete(userRolesTable).where(eq(userRolesTable.id, assignmentId));
    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: actor.id,
      action: "user_role.revoked",
      entityType: "user_role",
      entityId: assignmentId,
      metadata: {
        userId: assignment.userId,
        roleId: assignment.roleId,
        scopeType: assignment.scopeType,
        scopeId: assignment.scopeId,
      },
    });
  });

  revalidatePath("/dashboard/admin/users");
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; linkForUserId?: string; q?: string; status?: string; role?: string }>;
}) {
  const { error, linkForUserId, ...filters } = await searchParams;
  const q = typeof filters.q === "string" ? filters.q.trim().toLowerCase() : "";
  const statusFilter =
    filters.status === "invited" || filters.status === "active" || filters.status === "disabled"
      ? filters.status
      : null;
  const roleFilter = typeof filters.role === "string" && filters.role ? filters.role : null;
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

  // The people list is bounded by the size of the organisation and already
  // fully loaded, so it filters here. Role matching needs the assignments
  // that are loaded alongside it anyway.
  const rolesFor = (userId: string) => assignments.filter((a) => a.userId === userId).map((a) => a.roleId);
  const visibleUsers = tenantUsers.filter((u) => {
    if (statusFilter && u.status !== statusFilter) return false;
    if (roleFilter && !rolesFor(u.id).includes(roleFilter)) return false;
    if (!q) return true;
    return u.fullName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  // Recomputed on every render rather than stored — a set-password token
  // is only ever the current one for this user, so "generate" and
  // "regenerate after it expired" are the same action, no separate state
  // to track.
  const linkForUser = linkForUserId ? tenantUsers.find((u) => u.id === linkForUserId) : undefined;
  const setPasswordLink = linkForUser ? `${await getAppOrigin()}/set-password/${makeUserSetPasswordToken(linkForUser.id)}` : null;

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
      <div className="flex flex-col gap-2">
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Admin", href: "/dashboard/admin/departments" },
            { label: "Users & assignment" },
          ]}
        />
        <div>
          <h1 className="font-serif text-lg text-foreground">Users</h1>
          <p className="text-sm text-muted-foreground">{tenantUsers.length} in {tenant.name}</p>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        {setPasswordLink && linkForUser && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <p className="font-medium">Set-password link for {linkForUser.fullName}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              There&apos;s no email delivery wired up yet — copy this and send it to them yourself. Valid for 24 hours.
            </p>
            <input readOnly value={setPasswordLink} className="mt-2 w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs" />
          </div>
        )}

        <ListControls
          q={typeof filters.q === "string" ? filters.q : ""}
          searchPlaceholder="Name or email…"
          searchMatches="the person's name and email address"
          clearHref={q || statusFilter || roleFilter ? "/dashboard/admin/users" : undefined}
          count={visibleUsers.length}
        >
          <ListFilter
            name="status"
            label="Status"
            value={statusFilter ?? ""}
            options={[
              { value: "", label: "All" },
              { value: "invited", label: "Invited" },
              { value: "active", label: "Active" },
              { value: "disabled", label: "Disabled" },
            ]}
          />
          <ListFilter
            name="role"
            label="Role"
            value={roleFilter ?? ""}
            options={[
              { value: "", label: "Any role" },
              ...roles.map((r) => ({ value: r.id, label: r.displayName })),
            ]}
          />
        </ListControls>

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
            {visibleUsers.map((u) => (
              <tr key={u.id} className="border-b">
                <td className="py-2">{u.fullName}</td>
                <td className="py-2 text-muted-foreground">{u.email}</td>
                <td className="py-2">{u.status}</td>
                <td className="py-2">
                  <div className="flex justify-end gap-2">
                    <form action={generateSetPasswordLinkAction}>
                      <input type="hidden" name="userId" value={u.id} />
                      <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                        {u.status === "invited" ? "Get set-password link" : "Reset password"}
                      </button>
                    </form>
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
                  </div>
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
          Invited users show as &quot;invited&quot; until they open their set-password link and choose a password — copy
          it from the button above and send it to them yourself, there&apos;s no email delivery wired up yet.
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
              <th></th>
            </tr>
          </thead>
          <tbody>
            {assignments.map((a) => (
              <tr key={a.id} className="border-b">
                <td className="py-2">{nameFor.user(a.userId)}</td>
                <td className="py-2">{nameFor.role(a.roleId)}</td>
                <td className="py-2">{nameFor.scope(a.scopeType, a.scopeId)}</td>
                <td className="py-2">
                  <form action={revokeRole}>
                    <input type="hidden" name="assignmentId" value={a.id} />
                    <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                      Revoke
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {error && <p className="text-sm text-destructive">{error}</p>}

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
