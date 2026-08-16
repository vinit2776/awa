import { getCurrentPlatformAdmin, PlatformAdminAccessError } from "@/db/platformSession";
import { PlatformNav } from "./PlatformNav";

/**
 * Added when the support console arrived: /platform was a single page.tsx that
 * did its own getCurrentPlatformAdmin try/catch inline. Three more pages each
 * repeating that check is three more chances to forget it, so the shell moved
 * here.
 *
 * When there's no valid platform session this deliberately renders `children`
 * bare, with no nav — it does NOT render its own access-denied state. Platform
 * auth is app-managed (db/userAuth.ts): /platform/page.tsx renders the sign-in
 * form itself, so a layout that intercepted PlatformAdminAccessError would sit
 * in front of that form and make signing in impossible. The pages under this
 * layout each send an unauthenticated visitor to /platform to sign in.
 *
 * The nav being hidden is only the UI-level cue. The enforcement boundary is
 * getCurrentSupportAgent()/getCurrentPlatformAdmin() inside each page and
 * server action, since a hidden nav doesn't stop a direct POST.
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  let admin;
  try {
    admin = await getCurrentPlatformAdmin();
  } catch (error) {
    if (error instanceof PlatformAdminAccessError) {
      return <div className="flex flex-1 flex-col">{children}</div>;
    }
    throw error;
  }

  return (
    <div className="flex flex-1">
      <aside className="flex w-56 shrink-0 flex-col justify-between border-r border-sidebar-border bg-sidebar p-4">
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-2 px-1">
            <span className="flex size-7 items-center justify-center rounded-md bg-sidebar-primary font-serif text-sm text-sidebar-primary-foreground">
              A
            </span>
            <span className="font-serif text-lg text-sidebar-foreground">AWA</span>
          </div>
          <div>
            <p className="px-1 pb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Platform
            </p>
            <PlatformNav />
          </div>
        </div>
        <div className="border-t border-sidebar-border px-1 pt-4">
          <p className="truncate text-sm font-medium text-sidebar-foreground">Platform console</p>
          <p className="truncate text-xs text-sidebar-foreground/60">
            {admin.email} · {admin.role}
          </p>
        </div>
      </aside>

      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
