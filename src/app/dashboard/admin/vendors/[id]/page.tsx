import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { vendors as vendorsTable, vendorBankAccounts as bankAccountsTable, users as usersTable } from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { submitBankAccount, verifyBankAccount } from "./actions";

export default async function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { tenant } = await getCurrentUserAndTenant();

  const [vendor, bankAccounts, users] = await withTenant(tenant.id, async (tx) => [
    (await tx.select().from(vendorsTable).where(eq(vendorsTable.id, id)))[0] ?? null,
    await tx.select().from(bankAccountsTable).where(eq(bankAccountsTable.vendorId, id)),
    await tx.select().from(usersTable),
  ]);

  if (!vendor) notFound();

  const userName = (id: string | null) => users.find((u) => u.id === id)?.fullName ?? "—";

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-lg font-medium">{vendor.name}</h1>
        <p className="text-sm text-muted-foreground">
          {vendor.status} · Registered phone: {vendor.registeredPhone ?? "not on file"}
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Bank accounts</h2>
        <p className="max-w-xl text-xs text-muted-foreground">
          A new account starts pending and isn&apos;t usable until verified — call the vendor at their registered
          phone above (never a number given alongside the change itself) and confirm the details verbally before
          verifying here. Verifying supersedes whatever was previously active; there&apos;s never a gap and never
          an unverified account live at the same time as a verified one.
        </p>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 font-normal">Holder</th>
              <th className="py-2 font-normal">Bank</th>
              <th className="py-2 font-normal">Account</th>
              <th className="py-2 font-normal">Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {bankAccounts.map((b) => (
              <tr key={b.id} className="border-b align-top">
                <td className="py-2">{b.accountHolderName}</td>
                <td className="py-2">{b.bankName} ({b.ifscOrSwift})</td>
                <td className="py-2">••••{b.accountNumberLast4}</td>
                <td className="py-2">
                  {b.status}
                  {b.status === "active" && b.verifiedBy && (
                    <p className="text-xs text-muted-foreground">Verified by {userName(b.verifiedBy)}</p>
                  )}
                </td>
                <td className="py-2">
                  {b.status === "pending_verification" && (
                    <form action={verifyBankAccount} className="flex flex-col items-start gap-1">
                      <input type="hidden" name="vendorId" value={vendor.id} />
                      <input type="hidden" name="bankAccountId" value={b.id} />
                      <label className="flex items-center gap-1.5 text-xs">
                        <input type="checkbox" name="confirmedCallback" required />
                        I called {vendor.registeredPhone ?? "(no number on file)"} and confirmed this
                      </label>
                      <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                        Verify
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <form action={submitBankAccount} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="vendorId" value={vendor.id} />
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Account holder</label>
            <input name="accountHolderName" required className="h-8 rounded-md border px-2 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Account number</label>
            <input name="accountNumber" required className="h-8 rounded-md border px-2 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Bank</label>
            <input name="bankName" required className="h-8 rounded-md border px-2 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">IFSC / SWIFT</label>
            <input name="ifscOrSwift" required className="h-8 rounded-md border px-2 text-sm" />
          </div>
          <button type="submit" className={cn(buttonVariants())}>Add (pending verification)</button>
        </form>
      </section>
    </div>
  );
}
