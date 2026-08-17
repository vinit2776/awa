import Link from "next/link";
import { eq, inArray } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { purchaseRequisitions as purchaseRequisitionsTable, rfqs as rfqsTable, users as usersTable, departments as departmentsTable } from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { cn } from "@/lib/utils";
import { sourcingStage } from "@/lib/lifecycle";
import { LifecycleStatus } from "@/components/ui/lifecycle-status";

export default async function SourcingPage() {
  const { tenant } = await getCurrentUserAndTenant();

  const [requisitions, users, departments] = await withTenant(tenant.id, async (tx) => [
    await tx.select().from(purchaseRequisitionsTable).where(eq(purchaseRequisitionsTable.status, "approved")),
    await tx.select().from(usersTable),
    await tx.select().from(departmentsTable),
  ]);

  const requisitionIds = requisitions.map((r) => r.id);
  const rfqRows = requisitionIds.length
    ? await withTenant(tenant.id, (tx) => tx.select().from(rfqsTable).where(inArray(rfqsTable.requisitionId, requisitionIds)))
    : [];
  const requisitionIdsWithRfq = new Set(rfqRows.map((rfq) => rfq.requisitionId));

  const requestorName = (id: string) => users.find((u) => u.id === id)?.fullName ?? "—";
  const departmentName = (id: string | null) => departments.find((d) => d.id === id)?.name ?? "—";

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex flex-col gap-2">
        <Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Sourcing" }]} />
        <div>
          <h1 className="font-serif text-lg text-foreground">Sourcing</h1>
          <p className="text-sm text-muted-foreground">{requisitions.length} approved requisitions ready to source</p>
        </div>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 font-normal">Requestor</th>
            <th className="py-2 font-normal">Department</th>
            <th className="py-2 font-normal">Total</th>
            <th className="py-2 font-normal">Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {requisitions.map((r) => (
            <tr key={r.id} className="border-b">
              <td className="py-2">{requestorName(r.requestorId)}</td>
              <td className="py-2">{departmentName(r.departmentId)}</td>
              <td className="py-2">{r.totalEstimatedValue} {r.currency}</td>
              <td className="py-2">
                <LifecycleStatus stage={sourcingStage(requisitionIdsWithRfq.has(r.id))} />
              </td>
              <td className="py-2">
                <Link href={`/dashboard/sourcing/${r.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                  Source
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
