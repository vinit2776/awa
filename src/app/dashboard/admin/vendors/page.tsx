import Link from "next/link";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { vendors as vendorsTable, vendorUsers as vendorUsersTable } from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { cn } from "@/lib/utils";
import { createVendor, setVendorStatus, addVendorContact } from "./actions";

export default async function VendorsPage() {
  const { tenant } = await getCurrentUserAndTenant();

  const [vendors, contacts] = await withTenant(tenant.id, async (tx) => [
    await tx.select().from(vendorsTable),
    await tx.select().from(vendorUsersTable),
  ]);

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-2">
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Admin", href: "/dashboard/admin/departments" },
            { label: "Vendors" },
          ]}
        />
        <div>
          <h1 className="font-serif text-lg text-foreground">Vendors</h1>
          <p className="text-sm text-muted-foreground">{vendors.length} in {tenant.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            A vendor contact added below can sign in at <code>/vendor-portal</code> with a one-time email link to view
            and confirm POs issued to their company — no password, no separate invite step needed here.
          </p>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 font-normal">Name</th>
              <th className="py-2 font-normal">Tax ID</th>
              <th className="py-2 font-normal">Status</th>
              <th className="py-2 font-normal">Contacts</th>
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {vendors.map((v) => (
              <tr key={v.id} className="border-b align-top">
                <td className="py-2">{v.name}</td>
                <td className="py-2">{v.taxId ?? "—"}</td>
                <td className="py-2">{v.status}</td>
                <td className="py-2">
                  <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                    {contacts
                      .filter((c) => c.vendorId === v.id)
                      .map((c) => (
                        <li key={c.id}>{c.fullName} ({c.email}) — {c.status}</li>
                      ))}
                  </ul>
                  <form action={addVendorContact} className="mt-1 flex items-end gap-1">
                    <input type="hidden" name="vendorId" value={v.id} />
                    <input name="fullName" placeholder="Name" className="h-7 w-28 rounded-md border px-1.5 text-xs" />
                    <input name="email" placeholder="Email" className="h-7 w-32 rounded-md border px-1.5 text-xs" />
                    <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>Add</button>
                  </form>
                </td>
                <td className="py-2">
                  <form action={setVendorStatus} className="flex items-center gap-1">
                    <input type="hidden" name="vendorId" value={v.id} />
                    <select name="status" defaultValue={v.status} className="h-7 rounded-md border px-1.5 text-xs">
                      <option value="pending">Pending</option>
                      <option value="active">Active</option>
                      <option value="blacklisted">Blacklisted</option>
                    </select>
                    <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>Save</button>
                  </form>
                </td>
                <td className="py-2">
                  <Link href={`/dashboard/admin/vendors/${v.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                    Manage
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">New vendor</h2>
        <form action={createVendor} className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Name</label>
            <input name="name" required className="h-8 rounded-md border px-2 text-sm" placeholder="e.g. Acme Valves Pvt Ltd" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Tax ID</label>
            <input name="taxId" className="h-8 rounded-md border px-2 text-sm" placeholder="e.g. GSTIN" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Registered phone</label>
            <input name="registeredPhone" className="h-8 rounded-md border px-2 text-sm" placeholder="for bank-detail callback verification" />
          </div>
          <button type="submit" className={cn(buttonVariants())}>Add</button>
        </form>
      </section>
    </div>
  );
}
