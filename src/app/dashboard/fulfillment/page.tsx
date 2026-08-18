import Link from "next/link";
import { eq, inArray } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { purchaseOrders as purchaseOrdersTable, vendors as vendorsTable, purchaseRequisitions as purchaseRequisitionsTable } from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { EmptyState } from "@/components/ui/empty-state";
import { Info, PageHelp, Term } from "@/components/ui/help";
import { cn } from "@/lib/utils";
import { poStage } from "@/lib/lifecycle";
import { LifecycleStatus } from "@/components/ui/lifecycle-status";

export default async function FulfillmentPage() {
  const { tenant } = await getCurrentUserAndTenant();

  const [purchaseOrders, vendors, beingSourced] = await withTenant(tenant.id, async (tx) => [
    await tx.select().from(purchaseOrdersTable).where(inArray(purchaseOrdersTable.status, ["issued", "partially_fulfilled"])),
    await tx.select().from(vendorsTable),
    await tx.select().from(purchaseRequisitionsTable).where(eq(purchaseRequisitionsTable.status, "approved")),
  ]);

  const vendorName = (id: string) => vendors.find((v) => v.id === id)?.name ?? "—";

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex flex-col gap-2">
        <Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Fulfillment" }]} />
        <div>
          <h1 className="font-serif text-lg text-foreground">Fulfillment</h1>
          <p className="text-sm text-muted-foreground">
            Record what actually arrived. Purchase orders land here once issued and stay until every line is
            received or accepted — then the vendor can invoice against them.
          </p>
        </div>
      </div>

      <PageHelp
        id="fulfillment"
        title="How receiving works"
        steps={{
          record: (
            <>
              Open the purchase order the delivery is against and record a <Term name="goods-receipt" sentenceCase /> — or, for
              work rather than goods, a <Term name="service-acceptance" sentenceCase />.
            </>
          ),
          partial: "A short delivery is fine. Record what turned up; the line stays open for the balance.",
          sod: (
            <>
              The person who raised the requisition cannot be the person who receives it (
              <Term name="segregation-of-duties">segregation of duties</Term>), so this may need a colleague.
            </>
          ),
        }}
      />

      {purchaseOrders.length === 0 ? (
        <EmptyState title="No deliveries outstanding">
          Purchase orders arrive here the moment they are issued to a vendor, and leave once every line has been
          received or accepted.{" "}
          {beingSourced.length > 0 ? (
            <>
              {beingSourced.length} approved {beingSourced.length === 1 ? "requisition is" : "requisitions are"}{" "}
              still being sourced — no purchase order exists for {beingSourced.length === 1 ? "it" : "them"} yet.
            </>
          ) : (
            <>Nothing is being sourced either, so no purchase orders are on the way.</>
          )}
          {beingSourced.length > 0 && (
            <div className="mt-3">
              <Link href="/dashboard/sourcing" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                Go to sourcing
              </Link>
            </div>
          )}
        </EmptyState>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-4 font-normal">PO</th>
              <th className="py-2 pr-4 font-normal">Vendor</th>
              <th className="py-2 pr-4 font-normal">Total</th>
              <th className="py-2 pr-4 font-normal">
                Status
                <Info
                  title="Delivery status"
                  next="Open one to record what arrived — a short delivery keeps the line open for the balance."
                >
                  &ldquo;Awaiting fulfillment&rdquo; means nothing has been received yet. &ldquo;Partially
                  fulfilled&rdquo; means some quantity arrived and the rest is still owed.
                </Info>
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {purchaseOrders.map((po) => (
              <tr key={po.id} className="border-b">
                <td className="py-2 pr-4 whitespace-nowrap">{po.poNumber}</td>
                <td className="py-2 pr-4">{vendorName(po.vendorId)}</td>
                <td className="py-2 pr-4 whitespace-nowrap">{po.totalAmount} {po.currency}</td>
                <td className="py-2 pr-4"><LifecycleStatus stage={poStage(po)} /></td>
                <td className="py-2">
                  <Link href={`/dashboard/fulfillment/${po.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
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
