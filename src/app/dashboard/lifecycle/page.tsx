import Link from "next/link";
import { desc } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import {
  purchaseRequisitions as purchaseRequisitionsTable,
  rfqs as rfqsTable,
  purchaseOrders as purchaseOrdersTable,
  invoices as invoicesTable,
  paymentInstructions as paymentInstructionsTable,
  users as usersTable,
} from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { cn } from "@/lib/utils";
import { computeStage } from "./stage";

export default async function LifecyclePage() {
  const { tenant } = await getCurrentUserAndTenant();

  const [requisitions, rfqRows, poRows, invoiceRows, paymentRows, users] = await withTenant(tenant.id, async (tx) => [
    await tx.select().from(purchaseRequisitionsTable).orderBy(desc(purchaseRequisitionsTable.createdAt)),
    await tx.select().from(rfqsTable),
    await tx.select().from(purchaseOrdersTable),
    await tx.select().from(invoicesTable),
    await tx.select().from(paymentInstructionsTable),
    await tx.select().from(usersTable),
  ]);

  const requestorName = (id: string) => users.find((u) => u.id === id)?.fullName ?? "—";

  const rows = requisitions.map((r) => {
    const rfqsForReq = rfqRows.filter((rfq) => rfq.requisitionId === r.id);
    const po = poRows.find((p) => p.requisitionId === r.id);
    const invoice = po ? invoiceRows.find((i) => i.poId === po.id) : undefined;
    const payment = invoice ? paymentRows.find((p) => p.invoiceId === invoice.id) : undefined;
    return { requisition: r, stage: computeStage(r, rfqsForReq, po, invoice, payment) };
  });

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex flex-col gap-2">
        <Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Lifecycle" }]} />
        <div>
          <h1 className="font-serif text-lg text-foreground">Lifecycle</h1>
          <p className="text-sm text-muted-foreground">{requisitions.length} requisitions in {tenant.name}</p>
        </div>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 font-normal">Requestor</th>
            <th className="py-2 font-normal">Total</th>
            <th className="py-2 font-normal">Stage</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ requisition, stage }) => (
            <tr key={requisition.id} className="border-b">
              <td className="py-2">{requestorName(requisition.requestorId)}</td>
              <td className="py-2">{requisition.totalEstimatedValue} {requisition.currency}</td>
              <td className="py-2">{stage}</td>
              <td className="py-2">
                <Link href={`/dashboard/requisitions/${requisition.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
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
