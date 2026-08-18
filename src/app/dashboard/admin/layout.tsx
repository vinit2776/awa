import { getCurrentUserAndTenant } from "@/db/session";
import { isTenantAdmin } from "@/db/permissions";
import { withTenant } from "@/db/withTenant";
import { AdminNav } from "./AdminNav";

// Gated to holders of the "Tenant admin" role (db/permissions.ts). This is
// the UI-level check, so a denied user sees a message instead of the nav —
// the actual enforcement boundary is requireTenantAdmin() inside each
// mutating server action, since a hidden form doesn't stop a direct call
// to the action itself.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, tenant } = await getCurrentUserAndTenant();
  const allowed = await withTenant(tenant.id, (tx) => isTenantAdmin(tx, tenant.id, user.id));

  if (!allowed) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <h1 className="font-serif text-lg text-foreground">Access restricted</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Only users with the Tenant admin role can manage {tenant.name}&apos;s admin settings. Ask your tenant
            admin to grant you that role from Users &amp; assignment.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1">
      <nav className="w-48 shrink-0 border-r border-border p-4 text-sm">
        <p className="mb-3 text-xs font-medium text-muted-foreground">{tenant.name}</p>
        <AdminNav />
      </nav>
      {/* min-w-0 for the same reason the dashboard <main> needs it: as a
          flex item this defaults to min-width:auto, so a wide table — the
          audit log, whose entity column is full uuids — pushes the whole
          admin section sideways instead of scrolling within itself. */}
      <div className="min-w-0 flex-1 p-6">{children}</div>
    </div>
  );
}
