import { redirect } from "next/navigation";
import { getCurrentUserAndTenant } from "@/db/session";
import { clearAppSessionCookie } from "@/db/userSession";
import { isTenantAdmin } from "@/db/permissions";
import { withTenant } from "@/db/withTenant";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isStorageConfigured } from "@/db/storage";
import { DashboardNav } from "./DashboardNav";
import { PushNotifications } from "./PushNotifications";
import { ReportWidget } from "./ReportWidget";


export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  const { user, tenant } = await getCurrentUserAndTenant();
  const showAdmin = await withTenant(tenant.id, (tx) => isTenantAdmin(tx, tenant.id, user.id));

  async function handleSignOut() {
    "use server";
    await clearAppSessionCookie();
    redirect("/");
  }

  return (
    <div className="flex flex-1">
      <aside className="flex w-60 shrink-0 flex-col justify-between border-r border-sidebar-border bg-sidebar p-4">
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-2 px-1">
            <span className="flex size-7 items-center justify-center rounded-md bg-sidebar-primary font-serif text-sm text-sidebar-primary-foreground">
              A
            </span>
            <span className="font-serif text-lg text-sidebar-foreground">AWA</span>
          </div>
          <DashboardNav showAdmin={showAdmin} />
        </div>

        <div className="flex flex-col gap-3 border-t border-sidebar-border pt-4">
          <div className="px-1">
            <p className="truncate text-sm font-medium text-sidebar-foreground">{tenant.name}</p>
            <p className="truncate text-xs text-sidebar-foreground/60">{user.fullName}</p>
          </div>
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

      {/* min-w-0 matters: as a flex item this defaults to min-width:auto,
          so a wide table inside pushes the whole page sideways instead of
          scrolling within its own container. */}
      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
