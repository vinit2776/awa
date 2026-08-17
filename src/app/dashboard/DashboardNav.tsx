"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ClipboardList,
  CircleCheckBig,
  Search,
  Truck,
  Receipt,
  Wallet,
  BarChart3,
  Settings,
  LifeBuoy,
  MessageCircleQuestion,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// "Lifecycle" used to sit between Payments and Reports. It was a second
// requisition list with the requestorId filter left off — one table, two
// nav entries, which reads as two different things to somebody meeting
// the app for the first time. It is a scope filter on Requisitions now.
const NAV_ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/dashboard/requisitions", label: "Requisitions", icon: ClipboardList },
  { href: "/dashboard/approvals", label: "Approvals", icon: CircleCheckBig },
  { href: "/dashboard/sourcing", label: "Sourcing", icon: Search },
  { href: "/dashboard/fulfillment", label: "Fulfillment", icon: Truck },
  { href: "/dashboard/invoices", label: "Invoices", icon: Receipt },
  { href: "/dashboard/payments", label: "Payments", icon: Wallet },
  { href: "/dashboard/reports", label: "Reports", icon: BarChart3 },
  { href: "/dashboard/queries", label: "Queries", icon: MessageCircleQuestion },
  { href: "/dashboard/support", label: "Support", icon: LifeBuoy },
];

const ADMIN_NAV_ITEM = { href: "/dashboard/admin/departments", label: "Admin", icon: Settings };

export function DashboardNav({ showAdmin }: { showAdmin: boolean }) {
  const pathname = usePathname();
  const items = showAdmin ? [...NAV_ITEMS, ADMIN_NAV_ITEM] : NAV_ITEMS;

  return (
    <nav className="flex flex-col gap-0.5">
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-sidebar-primary/10 text-sidebar-primary"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
