import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { signatories as signatoriesTable, users as usersTable } from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { cn } from "@/lib/utils";
import { createSignatory, toggleSignatoryActive } from "./actions";

export default async function SignatoriesPage() {
  const { tenant } = await getCurrentUserAndTenant();

  const [signatoryRows, users] = await withTenant(tenant.id, async (tx) => [
    await tx.select().from(signatoriesTable),
    await tx.select().from(usersTable),
  ]);

  const userName = (id: string) => users.find((u) => u.id === id)?.fullName ?? "—";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Admin", href: "/dashboard/admin/departments" },
            { label: "Signatories" },
          ]}
        />
        <div>
          <h1 className="font-serif text-lg text-foreground">Signatories</h1>
          <p className="text-sm text-muted-foreground">
            {signatoryRows.length} in {tenant.name} — shown on the public PO verification page so a vendor can confirm who&apos;s authorized to sign.
          </p>
        </div>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 font-normal">Name</th>
            <th className="py-2 font-normal">Title</th>
            <th className="py-2 font-normal">Max authorized value</th>
            <th className="py-2 font-normal">Active</th>
          </tr>
        </thead>
        <tbody>
          {signatoryRows.map((s) => (
            <tr key={s.id} className="border-b">
              <td className="py-2">{userName(s.userId)}</td>
              <td className="py-2">{s.title}</td>
              <td className="py-2">{s.maxAuthorizedValue ?? "Unlimited"}</td>
              <td className="py-2">
                <form action={toggleSignatoryActive}>
                  <input type="hidden" name="signatoryId" value={s.id} />
                  <input type="hidden" name="active" value={(!s.active).toString()} />
                  <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                    {s.active ? "Deactivate" : "Activate"}
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form action={createSignatory} className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">User</label>
          <select name="userId" required className="h-8 rounded-md border px-2 text-sm">
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.fullName}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Title</label>
          <input name="title" required className="h-8 rounded-md border px-2 text-sm" placeholder="e.g. Director" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Max authorized value</label>
          <input name="maxAuthorizedValue" type="number" step="0.01" placeholder="unlimited" className="h-8 w-36 rounded-md border px-2 text-sm" />
        </div>
        <button type="submit" className={cn(buttonVariants())}>Add signatory</button>
      </form>
    </div>
  );
}
