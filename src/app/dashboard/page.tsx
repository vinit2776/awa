import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { users as usersTable } from "@/db/schema";

export default async function DashboardPage() {
  const { user, tenant } = await getCurrentUserAndTenant();

  // Proves the whole chain: this query runs inside withTenant's
  // transaction, scoped by RLS to tenant.id — not by this WHERE clause.
  // Omitting a tenant filter here entirely is the point.
  const tenantUsers = await withTenant(tenant.id, (tx) => tx.select().from(usersTable));

  return (
    <div className="flex flex-1 flex-col gap-6 p-8">
      <div>
        <h1 className="font-serif text-2xl text-foreground">{tenant.name}</h1>
        <p className="text-sm text-muted-foreground">
          Signed in as {user.fullName} ({user.email})
        </p>
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
