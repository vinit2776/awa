import Link from "next/link";
import { desc, inArray } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { invoices as invoicesTable, vendors as vendorsTable, paymentInstructions as paymentInstructionsTable } from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { cn } from "@/lib/utils";
import { invoiceStage } from "@/lib/lifecycle";
import { LifecycleStatus } from "@/components/ui/lifecycle-status";

export default async function InvoicesPage() {
  const { tenant } = await getCurrentUserAndTenant();

  const [invoiceRows, vendors] = await withTenant(tenant.id, async (tx) => [
    await tx.select().from(invoicesTable).orderBy(desc(invoicesTable.createdAt)),
    await tx.select().from(vendorsTable),
  ]);

  const invoiceIdsAwaitingPayment = invoiceRows.filter((i) => i.status === "approved_for_payment").map((i) => i.id);
  const paymentRows = invoiceIdsAwaitingPayment.length
    ? await withTenant(tenant.id, (tx) => tx.select().from(paymentInstructionsTable).where(inArray(paymentInstructionsTable.invoiceId, invoiceIdsAwaitingPayment)))
    : [];
  const paymentFor = (invoiceId: string) => paymentRows.find((p) => p.invoiceId === invoiceId);

  const vendorName = (id: string) => vendors.find((v) => v.id === id)?.name ?? "—";
  const exceptionCount = invoiceRows.filter((i) => i.status === "exception").length;

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex flex-col gap-2">
        <Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Invoices" }]} />
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-serif text-lg text-foreground">Invoices</h1>
            <p className="text-sm text-muted-foreground">
              {invoiceRows.length} in {tenant.name}
              {exceptionCount > 0 && <span className="text-amber-600"> · {exceptionCount} need review</span>}
            </p>
          </div>
          <Link href="/dashboard/invoices/new" className={cn(buttonVariants())}>
            Capture invoice
          </Link>
        </div>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 font-normal">Invoice #</th>
            <th className="py-2 font-normal">Vendor</th>
            <th className="py-2 font-normal">Date</th>
            <th className="py-2 font-normal">Total</th>
            <th className="py-2 font-normal">Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {invoiceRows.map((i) => (
            <tr key={i.id} className="border-b">
              <td className="py-2">{i.invoiceNumber}</td>
              <td className="py-2">{vendorName(i.vendorId)}</td>
              <td className="py-2">{i.invoiceDate}</td>
              <td className="py-2">{i.totalAmount} {i.currency}</td>
              <td className="py-2">
                <LifecycleStatus stage={invoiceStage(i, paymentFor(i.id))} />
              </td>
              <td className="py-2">
                <Link href={`/dashboard/invoices/${i.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                  Open
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
