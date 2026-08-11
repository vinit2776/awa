import { getCurrentUserAndTenant } from "@/db/session";
import { AdminNav } from "./AdminNav";

// No permission gating yet — any signed-in tenant member can reach these
// pages. Fine-grained enforcement (only tenant admins / specific roles)
// is a real gap, not an oversight to be quiet about — it needs its own
// pass once user_roles assignment (this sprint) has real data to check
// against.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { tenant } = await getCurrentUserAndTenant();

  return (
    <div className="flex flex-1">
      <nav className="w-48 shrink-0 border-r border-border p-4 text-sm">
        <p className="mb-3 text-xs font-medium text-muted-foreground">{tenant.name}</p>
        <AdminNav />
      </nav>
      <div className="flex-1 p-6">{children}</div>
    </div>
  );
}
