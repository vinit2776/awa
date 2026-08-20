"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  House,
  ClipboardList,
  CircleCheckBig,
  MessageCircleQuestion,
  Search,
  Truck,
  Receipt,
  Wallet,
  Compass,
  BookOpen,
  ChartColumn,
  LifeBuoy,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavCounts } from "@/lib/navCounts";

type NavRow = { href: string; label: string; icon: LucideIcon; countKey?: keyof NavCounts };

// "Today" sits inside "Yours" rather than only being the logo's
// destination — the redesign's point is that most of the process isn't
// the reader's job, and burying the one page that says so behind a logo
// click undersells it. "Queries" (Questions for me) isn't in the design
// handoff's own sidebar mockup, which only lists three "Yours" rows —
// added back here because /dashboard/queries is a real, existing page
// and dropping it from primary nav would make it unreachable, not just
// unstyled.
const YOURS: NavRow[] = [
  { href: "/dashboard", label: "Today", icon: House },
  { href: "/dashboard/requisitions", label: "My requests", icon: ClipboardList, countKey: "myRequests" },
  { href: "/dashboard/approvals", label: "Waiting on me", icon: CircleCheckBig, countKey: "waitingOnMe" },
  { href: "/dashboard/queries", label: "Questions for me", icon: MessageCircleQuestion, countKey: "queries" },
];

const SHARED: NavRow[] = [
  { href: "/dashboard/sourcing", label: "Sourcing", icon: Search, countKey: "sourcing" },
  { href: "/dashboard/fulfillment", label: "Deliveries", icon: Truck, countKey: "fulfillment" },
  { href: "/dashboard/invoices", label: "Invoices", icon: Receipt, countKey: "invoices" },
  { href: "/dashboard/payments", label: "Payments", icon: Wallet, countKey: "payments" },
];

const FOOTER: NavRow[] = [
  { href: "/dashboard/help", label: "How AWA works", icon: BookOpen },
  { href: "/dashboard/reports", label: "Reports", icon: ChartColumn },
  { href: "/dashboard/support", label: "Get help", icon: LifeBuoy },
];

function useIsActive() {
  const pathname = usePathname();
  return (href: string) => pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ item, active, dim, count }: { item: NavRow; active: boolean; dim?: boolean; count?: number }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
        active
          ? "bg-primary/10 font-medium text-primary"
          : dim
            ? "text-muted-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            : "text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-foreground",
      )}
    >
      <item.icon className="size-4 shrink-0" />
      <span className="flex-1">{item.label}</span>
      {!!count && (
        <span
          className={cn(
            "min-w-[18px] rounded-full px-1.5 py-0.5 text-center text-[11px] font-medium",
            active ? "bg-primary/15 text-primary" : "bg-foreground/[0.06] text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </Link>
  );
}

/** Primary nav: the pinned admin-setup row, "Yours," and "The rest of the process." */
export function DashboardNav({
  showAdmin,
  counts,
  adminProgress,
}: {
  showAdmin: boolean;
  counts: NavCounts;
  adminProgress: { done: number; required: number } | null;
}) {
  const isActive = useIsActive();

  return (
    <nav className="flex flex-col gap-5">
      {showAdmin && (
        <Link
          href="/dashboard/admin"
          aria-current={isActive("/dashboard/admin") ? "page" : undefined}
          className={cn(
            "flex items-center gap-2.5 rounded-lg border border-primary/35 px-3 py-2.5 text-primary transition-colors",
            isActive("/dashboard/admin") ? "bg-primary/14" : "bg-primary/[0.07] hover:bg-primary/10",
          )}
        >
          <Compass className="size-4 shrink-0" />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">Start here</span>
            <span className="text-[11px] opacity-80">
              {adminProgress ? `${adminProgress.done} of ${adminProgress.required} done` : "Set up your tenant"}
            </span>
          </span>
        </Link>
      )}

      <div className="flex flex-col gap-1">
        <p className="mb-0.5 px-3 text-[10.5px] font-medium tracking-[0.09em] text-muted-foreground/80 uppercase">
          Yours
        </p>
        {YOURS.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={isActive(item.href)}
            count={item.countKey ? counts[item.countKey] : undefined}
          />
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <p className="mb-0.5 px-3 text-[10.5px] font-medium tracking-[0.09em] text-muted-foreground/80 uppercase">
          The rest of the process
        </p>
        {SHARED.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={isActive(item.href)}
            dim
            count={item.countKey ? counts[item.countKey] : undefined}
          />
        ))}
        <p className="mt-1 px-3 text-[11px] leading-relaxed text-muted-foreground/80">
          Nobody&apos;s job in particular — you can look, and see who has what.
        </p>
      </div>
    </nav>
  );
}

/** The three utility links (help, reports, support) that sit above the user chip, not inside the main nav groups. */
export function DashboardFooterNav() {
  const isActive = useIsActive();
  return (
    <nav className="flex flex-col gap-0.5">
      {FOOTER.map((item) => (
        <NavLink key={item.href} item={item} active={isActive(item.href)} />
      ))}
    </nav>
  );
}
