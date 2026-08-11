import Link from "next/link";
import { signOut } from "@workos-inc/authkit-nextjs";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { users as usersTable } from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default async function DashboardPage() {
  const { user, tenant } = await getCurrentUserAndTenant();

  // Proves the whole chain: this query runs inside withTenant's
  // transaction, scoped by RLS to tenant.id — not by this WHERE clause.
  // Omitting a tenant filter here entirely is the point.
  const tenantUsers = await withTenant(tenant.id, (tx) => tx.select().from(usersTable));

  async function handleSignOut() {
    "use server";
    await signOut({ returnTo: "/" });
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-medium">{tenant.name}</h1>
          <p className="text-sm text-muted-foreground">
            Signed in as {user.fullName} ({user.email})
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/requisitions" className={cn(buttonVariants({ variant: "outline" }))}>
            My requests
          </Link>
          <Link href="/dashboard/approvals" className={cn(buttonVariants({ variant: "outline" }))}>
            Approvals
          </Link>
          <Link href="/dashboard/sourcing" className={cn(buttonVariants({ variant: "outline" }))}>
            Sourcing
          </Link>
          <Link href="/dashboard/fulfillment" className={cn(buttonVariants({ variant: "outline" }))}>
            Fulfillment
          </Link>
          <Link href="/dashboard/admin/departments" className={cn(buttonVariants({ variant: "outline" }))}>
            Admin
          </Link>
          <form action={handleSignOut}>
            <button type="submit" className={cn(buttonVariants({ variant: "outline" }))}>
              Sign out
            </button>
          </form>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">
          Users in your tenant ({tenantUsers.length})
        </h2>
        <ul className="flex flex-col gap-1">
          {tenantUsers.map((u) => (
            <li key={u.id} className="text-sm">
              {u.fullName} — {u.email} — {u.status}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
