import { signOut } from "@workos-inc/authkit-nextjs";
import { getCurrentUserAndTenant } from "@/db/session";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DashboardNav } from "./DashboardNav";
import { PushNotifications } from "./PushNotifications";


export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  const { user, tenant } = await getCurrentUserAndTenant();

  async function handleSignOut() {
    "use server";
    await signOut({ returnTo: "/" });
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
          <DashboardNav />
        </div>

        <div className="flex flex-col gap-3 border-t border-sidebar-border pt-4">
          <div className="px-1">
            <p className="truncate text-sm font-medium text-sidebar-foreground">{tenant.name}</p>
            <p className="truncate text-xs text-sidebar-foreground/60">{user.fullName}</p>
          </div>
          <PushNotifications />
          <form action={handleSignOut}>
            <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full")}>
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
