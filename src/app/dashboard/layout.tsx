import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUserAndTenant } from "@/db/session";
import { clearAppSessionCookie } from "@/db/userSession";
import { isTenantAdmin } from "@/db/permissions";
import { withTenant } from "@/db/withTenant";
import { buttonVariants } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { isStorageConfigured } from "@/db/storage";
import { hasFlag, AWA_REDESIGN_FLAG } from "@/lib/featureFlags";
import { getNavCounts, getAdminSetupProgress } from "@/lib/navCounts";
import { DashboardNav, DashboardFooterNav } from "./DashboardNav";
import { DashboardNavLegacy } from "./DashboardNavLegacy";
import { DashboardShell } from "./DashboardShell";
import { PushNotifications } from "./PushNotifications";
import { ReportWidget } from "./ReportWidget";
import { ErrorCapture } from "./ErrorCapture";


export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  const { user, tenant } = await getCurrentUserAndTenant();
  const showAdmin = await withTenant(tenant.id, (tx) => isTenantAdmin(tx, tenant.id, user.id));
  const redesigned = hasFlag(tenant.featureFlags, AWA_REDESIGN_FLAG);

  async function handleSignOut() {
    "use server";
    await clearAppSessionCookie();
    redirect("/");
  }

  const sidebar = (
    <aside className="flex h-full w-60 shrink-0 flex-col justify-between overflow-y-auto border-r border-sidebar-border bg-sidebar p-4">
      <div className="flex flex-col gap-6">
        <Link href="/dashboard" className="flex items-center gap-2 px-1">
          <span className="flex size-7 items-center justify-center rounded-md bg-sidebar-primary font-serif text-sm text-sidebar-primary-foreground">
            A
          </span>
          <span className="font-serif text-lg text-sidebar-foreground">AWA</span>
        </Link>
        {redesigned ? (
          <DashboardNav
            showAdmin={showAdmin}
            counts={await getNavCounts(tenant.id, user.id)}
            adminProgress={showAdmin ? await getAdminSetupProgress(tenant.id) : null}
          />
        ) : (
          <DashboardNavLegacy showAdmin={showAdmin} />
        )}
      </div>

      <div className="flex flex-col gap-3 border-t border-sidebar-border pt-4">
        {redesigned ? (
          <>
            <DashboardFooterNav />
            <div className="flex items-center gap-2 rounded-lg bg-foreground/[0.03] p-2">
              <Avatar name={user.fullName} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-sidebar-foreground">{tenant.name}</p>
                <p className="truncate text-xs text-sidebar-foreground/60">{user.fullName}</p>
              </div>
            </div>
          </>
        ) : (
          <div className="px-1">
            <p className="truncate text-sm font-medium text-sidebar-foreground">{tenant.name}</p>
            <p className="truncate text-xs text-sidebar-foreground/60">{user.fullName}</p>
          </div>
        )}
        <PushNotifications />
        {/* Mounted in the shell, not on a page: reporting has to be possible
            from wherever the problem is, and the slide-over keeps that page
            on screen and in state behind it. */}
        <ReportWidget storageEnabled={isStorageConfigured()} />
        <form action={handleSignOut}>
          <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full")}>
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );

  return (
    <DashboardShell sidebar={sidebar}>
      <ErrorCapture />
      {/* min-w-0 matters: as a flex item this defaults to min-width:auto,
          so a wide table inside pushes the whole page sideways instead of
          scrolling within its own container. */}
      {children}
    </DashboardShell>
  );
}
