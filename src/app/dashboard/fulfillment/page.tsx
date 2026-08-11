import Link from "next/link";
import { inArray } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { purchaseOrders as purchaseOrdersTable, vendors as vendorsTable } from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default async function FulfillmentPage() {
  const { tenant } = await getCurrentUserAndTenant();

  const [purchaseOrders, vendors] = await withTenant(tenant.id, async (tx) => [
    await tx.select().from(purchaseOrdersTable).where(inArray(purchaseOrdersTable.status, ["issued", "partially_fulfilled"])),
    await tx.select().from(vendorsTable),
  ]);

  const vendorName = (id: string) => vendors.find((v) => v.id === id)?.name ?? "—";

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <h1 className="font-serif text-lg text-foreground">Fulfillment</h1>
        <p className="text-sm text-muted-foreground">{purchaseOrders.length} POs open for receipt or acceptance</p>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 font-normal">PO</th>
            <th className="py-2 font-normal">Vendor</th>
            <th className="py-2 font-normal">Total</th>
            <th className="py-2 font-normal">Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {purchaseOrders.map((po) => (
            <tr key={po.id} className="border-b">
              <td className="py-2">{po.poNumber}</td>
              <td className="py-2">{vendorName(po.vendorId)}</td>
              <td className="py-2">{po.totalAmount} {po.currency}</td>
              <td className="py-2">{po.status}</td>
              <td className="py-2">
                <Link href={`/dashboard/fulfillment/${po.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
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
