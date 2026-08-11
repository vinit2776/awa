import Link from "next/link";
import { getCurrentUserAndTenant } from "@/db/session";

// No permission gating yet — any signed-in tenant member can reach these
// pages. Fine-grained enforcement (only tenant admins / specific roles)
// is a real gap, not an oversight to be quiet about — it needs its own
// pass once user_roles assignment (this sprint) has real data to check
// against.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { tenant } = await getCurrentUserAndTenant();

  return (
    <div className="flex flex-1">
      <nav className="w-48 shrink-0 border-r p-4 text-sm">
        <p className="mb-3 text-xs font-medium text-muted-foreground">{tenant.name}</p>
        <ul className="flex flex-col gap-1">
          <li>
            <Link href="/dashboard/admin/departments" className="block rounded px-2 py-1.5 hover:bg-muted">
              Departments
            </Link>
          </li>
          <li>
            <Link href="/dashboard/admin/cost-centers" className="block rounded px-2 py-1.5 hover:bg-muted">
              Cost centers
            </Link>
          </li>
          <li>
            <Link href="/dashboard/admin/catalog" className="block rounded px-2 py-1.5 hover:bg-muted">
              Catalog
            </Link>
          </li>
          <li>
            <Link href="/dashboard/admin/approval-rules" className="block rounded px-2 py-1.5 hover:bg-muted">
              Approval rules
            </Link>
          </li>
          <li>
            <Link href="/dashboard/admin/vendors" className="block rounded px-2 py-1.5 hover:bg-muted">
              Vendors
            </Link>
          </li>
          <li>
            <Link href="/dashboard/admin/roles" className="block rounded px-2 py-1.5 hover:bg-muted">
              Roles
            </Link>
          </li>
          <li>
            <Link href="/dashboard/admin/users" className="block rounded px-2 py-1.5 hover:bg-muted">
              Users &amp; assignment
            </Link>
          </li>
        </ul>
      </nav>
      <div className="flex-1 p-6">{children}</div>
    </div>
  );
}
