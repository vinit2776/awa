"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ADMIN_NAV_ITEMS = [
  { href: "/dashboard/admin/departments", label: "Departments" },
  { href: "/dashboard/admin/cost-centers", label: "Cost centers" },
  { href: "/dashboard/admin/catalog", label: "Catalog" },
  { href: "/dashboard/admin/approval-rules", label: "Approval rules" },
  { href: "/dashboard/admin/vendors", label: "Vendors" },
  { href: "/dashboard/admin/signatories", label: "Signatories" },
  { href: "/dashboard/admin/roles", label: "Roles" },
  { href: "/dashboard/admin/users", label: "Users & assignment" },
  { href: "/dashboard/admin/audit", label: "Audit log" },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <ul className="flex flex-col gap-1">
      {ADMIN_NAV_ITEMS.map(({ href, label }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "block rounded-md px-2 py-1.5 transition-colors",
                active ? "bg-primary/10 text-primary" : "text-foreground/70 hover:bg-accent hover:text-foreground",
              )}
            >
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
