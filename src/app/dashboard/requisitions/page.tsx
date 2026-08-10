import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import {
  purchaseRequisitions as purchaseRequisitionsTable,
  departments as departmentsTable,
  costCenters as costCentersTable,
} from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { submitRequisition } from "./actions";

export default async function RequisitionsPage() {
  const { user, tenant } = await getCurrentUserAndTenant();

  const [requisitions, departments, costCenters] = await withTenant(tenant.id, async (tx) => [
    await tx
      .select()
      .from(purchaseRequisitionsTable)
      .where(eq(purchaseRequisitionsTable.requestorId, user.id))
      .orderBy(desc(purchaseRequisitionsTable.createdAt)),
    await tx.select().from(departmentsTable),
    await tx.select().from(costCentersTable),
  ]);

  const departmentName = (id: string | null) => departments.find((d) => d.id === id)?.name ?? "—";
  const costCenterName = (id: string | null) => costCenters.find((c) => c.id === id)?.name ?? "—";

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-medium">My requests</h1>
          <p className="text-sm text-muted-foreground">{requisitions.length} in {tenant.name}</p>
        </div>
        <Link href="/dashboard/requisitions/new" className={cn(buttonVariants())}>
          New requisition
        </Link>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 font-normal">Created</th>
            <th className="py-2 font-normal">Department</th>
            <th className="py-2 font-normal">Cost center</th>
            <th className="py-2 font-normal">Total</th>
            <th className="py-2 font-normal">Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {requisitions.map((r) => (
            <tr key={r.id} className="border-b">
              <td className="py-2">{r.createdAt.toISOString().slice(0, 10)}</td>
              <td className="py-2">{departmentName(r.departmentId)}</td>
              <td className="py-2">{costCenterName(r.costCenterId)}</td>
              <td className="py-2">{r.totalEstimatedValue} {r.currency}</td>
              <td className="py-2">{r.status}</td>
              <td className="py-2">
                {r.status === "draft" && (
                  <form action={submitRequisition}>
                    <input type="hidden" name="requisitionId" value={r.id} />
                    <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                      Submit
                    </button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
