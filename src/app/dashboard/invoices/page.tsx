import Link from "next/link";
import { desc, inArray } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { invoices as invoicesTable, vendors as vendorsTable, paymentInstructions as paymentInstructionsTable, purchaseOrders as purchaseOrdersTable } from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { EmptyState } from "@/components/ui/empty-state";
import { Info, PageHelp, Term } from "@/components/ui/help";
import { cn } from "@/lib/utils";
import { invoiceStage } from "@/lib/lifecycle";
import { LifecycleStatus } from "@/components/ui/lifecycle-status";

export default async function InvoicesPage() {
  const { tenant } = await getCurrentUserAndTenant();

  const [invoiceRows, vendors, openPos] = await withTenant(tenant.id, async (tx) => [
    await tx.select().from(invoicesTable).orderBy(desc(invoicesTable.createdAt)),
    await tx.select().from(vendorsTable),
    await tx.select().from(purchaseOrdersTable).where(inArray(purchaseOrdersTable.status, ["issued", "partially_fulfilled"])),
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
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="font-serif text-lg text-foreground">Invoices</h1>
            <p className="text-sm text-muted-foreground">
              Capture what vendors bill you, and check it against what was ordered and received before any money
              moves.
              {exceptionCount > 0 && (
                <span className="text-amber-600">
                  {" "}
                  {exceptionCount} {exceptionCount === 1 ? "invoice needs" : "invoices need"} review.
                </span>
              )}
            </p>
          </div>
          <Link href="/dashboard/invoices/new" className={cn(buttonVariants(), "shrink-0")}>
            Capture invoice
          </Link>
        </div>
      </div>

      <PageHelp
        id="invoices"
        title="How invoice checking works"
        steps={{
          capture: "Capture the vendor's invoice against the purchase order it bills for.",
          match: (
            <>
              AWA runs a <Term name="three-way-match" sentenceCase />: the purchase order, the goods receipt or service
              acceptance, and the invoice must agree on quantity and value.
            </>
          ),
          decide: (
            <>
              If they agree it can be approved for payment. If they don&apos;t, it becomes an{" "}
              <Term name="invoice-exception">exception</Term> and somebody has to decide before it can be paid.
            </>
          ),
        }}
      />

      {invoiceRows.length === 0 ? (
        <EmptyState title="No invoices captured yet">
          Invoices are entered here against the purchase order they bill for, so AWA can check them before
          anything is paid.{" "}
          {openPos.length > 0 ? (
            <>
              {openPos.length} purchase {openPos.length === 1 ? "order is" : "orders are"} open — a vendor invoice
              usually follows delivery.
            </>
          ) : (
            <>No purchase orders are open yet, so no vendor has anything to bill for.</>
          )}
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <Link href="/dashboard/invoices/new" className={cn(buttonVariants({ size: "sm" }))}>
              Capture an invoice
            </Link>
            {openPos.length > 0 && (
              <Link href="/dashboard/fulfillment" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                See open purchase orders
              </Link>
            )}
          </div>
        </EmptyState>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-4 font-normal">Invoice #</th>
              <th className="py-2 pr-4 font-normal">Vendor</th>
              <th className="py-2 pr-4 font-normal">Date</th>
              <th className="py-2 pr-4 font-normal">Total</th>
              <th className="py-2 pr-4 font-normal">
                Status
                <Info
                  title="Invoice status"
                  next="An exception can be approved anyway with a reason, or disputed with the vendor."
                >
                  &ldquo;Matched&rdquo; means the invoice agrees with the order and the receipt.
                  &ldquo;Exception&rdquo; means it doesn&apos;t, and payment is held until somebody decides.
                </Info>
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {invoiceRows.map((i) => (
              <tr key={i.id} className="border-b">
                <td className="py-2 pr-4 whitespace-nowrap">{i.invoiceNumber}</td>
                <td className="py-2 pr-4">{vendorName(i.vendorId)}</td>
                <td className="py-2 pr-4 whitespace-nowrap">{i.invoiceDate}</td>
                <td className="py-2 pr-4 whitespace-nowrap">{i.totalAmount} {i.currency}</td>
                <td className="py-2 pr-4">
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
      )}
    </div>
  );
}
