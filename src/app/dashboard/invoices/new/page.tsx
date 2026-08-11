import { eq, inArray } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import {
  purchaseOrders as purchaseOrdersTable,
  purchaseOrderLines as purchaseOrderLinesTable,
  invoices as invoicesTable,
  vendors as vendorsTable,
  catalogItems as catalogItemsTable,
} from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { cn } from "@/lib/utils";
import { createInvoice } from "../actions";

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ poId?: string; error?: string }> }) {
  const { poId, error } = await searchParams;
  const { tenant } = await getCurrentUserAndTenant();

  const [purchaseOrders, invoicedPoIds, vendors] = await withTenant(tenant.id, async (tx) => [
    await tx.select().from(purchaseOrdersTable).where(inArray(purchaseOrdersTable.status, ["issued", "partially_fulfilled", "fulfilled"])),
    (await tx.select({ poId: invoicesTable.poId }).from(invoicesTable)).map((r) => r.poId),
    await tx.select().from(vendorsTable),
  ]);

  const eligiblePOs = purchaseOrders.filter((po) => !invoicedPoIds.includes(po.id));
  const vendorName = (id: string) => vendors.find((v) => v.id === id)?.name ?? "—";

  if (!poId) {
    return (
      <div className="flex flex-col gap-6 p-8">
        <div className="flex flex-col gap-2">
          <Breadcrumbs
            items={[
              { label: "Dashboard", href: "/dashboard" },
              { label: "Invoices", href: "/dashboard/invoices" },
              { label: "Capture invoice" },
            ]}
          />
          <h1 className="font-serif text-lg text-foreground">Capture invoice</h1>
        </div>
        <form method="get" className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">PO</label>
            <select name="poId" required className="h-8 rounded-md border px-2 text-sm">
              {eligiblePOs.map((po) => (
                <option key={po.id} value={po.id}>{po.poNumber} — {vendorName(po.vendorId)}</option>
              ))}
            </select>
          </div>
          <button type="submit" className={cn(buttonVariants())}>Continue</button>
        </form>
      </div>
    );
  }

  const [po, lines, catalogItems] = await withTenant(tenant.id, async (tx) => [
    (await tx.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, poId)))[0] ?? null,
    await tx.select().from(purchaseOrderLinesTable).where(eq(purchaseOrderLinesTable.poId, poId)),
    await tx.select().from(catalogItemsTable),
  ]);

  const itemName = (itemId: string | null) => catalogItems.find((i) => i.id === itemId)?.name ?? null;

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex flex-col gap-2">
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Invoices", href: "/dashboard/invoices" },
            { label: "Capture invoice" },
          ]}
        />
        <div>
          <h1 className="font-serif text-lg text-foreground">Capture invoice</h1>
          <p className="text-sm text-muted-foreground">{po?.poNumber} — {vendorName(po?.vendorId ?? "")}</p>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <form action={createInvoice} className="flex flex-col gap-4">
        <input type="hidden" name="poId" value={poId} />
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Invoice number</label>
            <input name="invoiceNumber" required className="h-8 rounded-md border px-2 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Invoice date</label>
            <input name="invoiceDate" type="date" required className="h-8 rounded-md border px-2 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Currency</label>
            <input name="currency" defaultValue={po?.currency ?? "INR"} className="h-8 w-20 rounded-md border px-2 text-sm" />
          </div>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 font-normal">Item</th>
              <th className="py-2 font-normal">Quantity</th>
              <th className="py-2 font-normal">Unit price</th>
              <th className="py-2 font-normal">Line total</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b">
                <td className="py-2">
                  {l.serviceDescription ?? itemName(l.itemId) ?? "Item"}
                  <input type="hidden" name="poLineId" value={l.id} />
                </td>
                <td className="py-2">
                  <input name="quantity" type="number" step="0.001" defaultValue={l.quantity} className="h-8 w-24 rounded-md border px-2 text-sm" />
                </td>
                <td className="py-2">
                  <input name="unitPrice" type="number" step="0.01" defaultValue={l.unitPrice} className="h-8 w-24 rounded-md border px-2 text-sm" />
                </td>
                <td className="py-2">
                  <input name="lineTotal" type="number" step="0.01" defaultValue={l.lineTotal} className="h-8 w-24 rounded-md border px-2 text-sm" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <button type="submit" className={cn(buttonVariants(), "w-fit")}>Submit invoice</button>
      </form>
    </div>
  );
}
