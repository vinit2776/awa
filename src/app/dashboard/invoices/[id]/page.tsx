import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import {
  invoices as invoicesTable,
  invoiceLines as invoiceLinesTable,
  invoiceLineMatches as matchesTable,
  vendors as vendorsTable,
  purchaseOrders as purchaseOrdersTable,
} from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { cn } from "@/lib/utils";
import { approveForPayment, overrideException, disputeInvoice } from "../actions";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { tenant } = await getCurrentUserAndTenant();

  const [invoice, lines, matches, vendor, po] = await withTenant(tenant.id, async (tx) => {
    const [invoice] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, id));
    if (!invoice) return [null, [], [], null, null] as const;

    const lines = await tx.select().from(invoiceLinesTable).where(eq(invoiceLinesTable.invoiceId, id));
    const allMatches = lines.length
      ? (await Promise.all(lines.map((l) => tx.select().from(matchesTable).where(eq(matchesTable.invoiceLineId, l.id))))).flat()
      : [];
    const [vendor] = await tx.select().from(vendorsTable).where(eq(vendorsTable.id, invoice.vendorId));
    const [po] = invoice.poId ? await tx.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, invoice.poId)) : [null];

    return [invoice, lines, allMatches, vendor ?? null, po ?? null] as const;
  });

  if (!invoice) notFound();

  const matchFor = (invoiceLineId: string) => matches.find((m) => m.invoiceLineId === invoiceLineId);

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex flex-col gap-2">
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Invoices", href: "/dashboard/invoices" },
            { label: invoice.invoiceNumber },
          ]}
        />
        <div>
          <h1 className="font-serif text-lg text-foreground">{invoice.invoiceNumber}</h1>
          <p className="text-sm text-muted-foreground">
            {vendor?.name ?? "—"} · {po?.poNumber ?? "—"} · {invoice.totalAmount} {invoice.currency} ·{" "}
            <span className={invoice.status === "exception" ? "text-amber-600" : undefined}>{invoice.status}</span>
          </p>
        </div>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 font-normal">Quantity</th>
            <th className="py-2 font-normal">Unit price</th>
            <th className="py-2 font-normal">Line total</th>
            <th className="py-2 font-normal">Match</th>
            <th className="py-2 font-normal">Variance</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const match = matchFor(l.id);
            return (
              <tr key={l.id} className="border-b">
                <td className="py-2">{l.quantity}</td>
                <td className="py-2">{l.unitPrice}</td>
                <td className="py-2">{l.lineTotal}</td>
                <td className="py-2">
                  <span className={match?.status === "exception" ? "text-amber-600" : undefined}>{match?.status ?? "—"}</span>
                </td>
                <td className="py-2">{match?.variance ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {invoice.status === "matched" && (
        <form action={approveForPayment} className="w-fit">
          <input type="hidden" name="invoiceId" value={invoice.id} />
          <button type="submit" className={cn(buttonVariants())}>Send to payment queue</button>
        </form>
      )}

      {invoice.status === "exception" && (
        <div className="flex flex-col gap-3 rounded-md border border-amber-500 p-4">
          <p className="text-sm">This invoice doesn&apos;t match what was received or accepted. Review before proceeding.</p>
          <div className="flex flex-wrap items-end gap-2">
            <form action={overrideException} className="flex items-end gap-2">
              <input type="hidden" name="invoiceId" value={invoice.id} />
              <input name="reason" required placeholder="Why override?" className="h-8 w-56 rounded-md border px-2 text-sm" />
              <button type="submit" className={cn(buttonVariants())}>Approve anyway</button>
            </form>
            <form action={disputeInvoice} className="flex items-end gap-2">
              <input type="hidden" name="invoiceId" value={invoice.id} />
              <input name="reason" required placeholder="Dispute reason" className="h-8 w-56 rounded-md border px-2 text-sm" />
              <button type="submit" className={cn(buttonVariants({ variant: "outline" }))}>Dispute</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
