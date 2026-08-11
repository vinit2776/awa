import { eq } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { paymentInstructions as paymentInstructionsTable, invoices as invoicesTable, vendors as vendorsTable } from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { releasePayment } from "./actions";

export default async function PaymentsPage() {
  const { tenant } = await getCurrentUserAndTenant();

  const [payments, invoiceRows, vendors] = await withTenant(tenant.id, async (tx) => [
    await tx.select().from(paymentInstructionsTable).where(eq(paymentInstructionsTable.status, "queued")),
    await tx.select().from(invoicesTable),
    await tx.select().from(vendorsTable),
  ]);

  const invoiceFor = (id: string) => invoiceRows.find((i) => i.id === id);
  const vendorName = (id: string) => vendors.find((v) => v.id === id)?.name ?? "—";

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <h1 className="text-lg font-medium">Payment queue</h1>
        <p className="text-sm text-muted-foreground">{payments.length} queued for release in {tenant.name}</p>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 font-normal">Invoice</th>
            <th className="py-2 font-normal">Vendor</th>
            <th className="py-2 font-normal">Amount</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => {
            const invoice = invoiceFor(p.invoiceId);
            return (
              <tr key={p.id} className="border-b">
                <td className="py-2">{invoice?.invoiceNumber ?? "—"}</td>
                <td className="py-2">{invoice ? vendorName(invoice.vendorId) : "—"}</td>
                <td className="py-2">{p.amount} {p.currency}</td>
                <td className="py-2">
                  <form action={releasePayment}>
                    <input type="hidden" name="paymentId" value={p.id} />
                    <button type="submit" className={cn(buttonVariants({ size: "sm" }))}>Release</button>
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
