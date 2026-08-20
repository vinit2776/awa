"use client";

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The sidebar had no mobile breakpoint at all — a fixed 240px column
 * that just pushed page content sideways on a phone. Below `md`, it
 * becomes a slide-over drawer behind a hamburger button instead; at
 * `md` and up this renders exactly as it always has (`sidebar` is the
 * same `<aside>` JSX layout.tsx already builds).
 */
export function DashboardShell({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Closes the drawer after any navigation, including a tap on a nav
  // link inside it — those links live in DashboardNav/DashboardNavLegacy,
  // separate client components with no reason to know about this open
  // state, so watching the route is simpler than threading a callback
  // through every one of them. Adjusted during render (React's documented
  // pattern for "reset state when a prop changes"), not in an effect —
  // an effect here would double-render on every navigation for no reason.
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setOpen(false);
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-sidebar-border bg-sidebar px-4 py-2.5 md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="-ml-1.5 grid size-9 place-items-center rounded-md text-sidebar-foreground"
        >
          <Menu className="size-5" />
        </button>
        <span className="font-serif text-base text-sidebar-foreground">AWA</span>
        <span className="size-9" aria-hidden="true" />
      </div>

      <div className="flex flex-1">
        {open && (
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 bg-foreground/30 md:hidden"
          />
        )}

        <div
          className={cn(
            "fixed inset-y-0 left-0 z-40 -translate-x-full transition-transform duration-200 md:static md:z-auto md:translate-x-0",
            open && "translate-x-0",
          )}
        >
          {sidebar}
        </div>

        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
