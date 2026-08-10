import { notInArray, sql } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import {
  departments as departmentsTable,
  costCenters as costCentersTable,
  catalogCategories as catalogCategoriesTable,
  catalogItems as catalogItemsTable,
  purchaseRequisitions as purchaseRequisitionsTable,
} from "@/db/schema";
import { RequisitionForm } from "../RequisitionForm";

// Requisitions in these statuses don't consume budget — a draft isn't a
// commitment yet, and a cancelled/closed-rejected one never became one.
const NON_COMMITTED_STATUSES: ("draft" | "cancelled" | "rejected_closed")[] = [
  "draft",
  "cancelled",
  "rejected_closed",
];

export default async function NewRequisitionPage() {
  const { tenant } = await getCurrentUserAndTenant();

  const [departments, costCenters, categories, catalogItems, committedRows] = await withTenant(
    tenant.id,
    async (tx) => [
      await tx.select().from(departmentsTable),
      await tx.select().from(costCentersTable),
      await tx.select().from(catalogCategoriesTable),
      await tx.select().from(catalogItemsTable),
      await tx
        .select({
          costCenterId: purchaseRequisitionsTable.costCenterId,
          committed: sql<string>`coalesce(sum(${purchaseRequisitionsTable.totalEstimatedValue}), 0)`,
        })
        .from(purchaseRequisitionsTable)
        .where(notInArray(purchaseRequisitionsTable.status, NON_COMMITTED_STATUSES))
        .groupBy(purchaseRequisitionsTable.costCenterId),
    ],
  );

  const committedByCostCenter = Object.fromEntries(
    committedRows.filter((r) => r.costCenterId).map((r) => [r.costCenterId as string, Number(r.committed)]),
  );

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <h1 className="text-lg font-medium">New requisition</h1>
        <p className="text-sm text-muted-foreground">{tenant.name}</p>
      </div>
      <RequisitionForm
        departments={departments}
        costCenters={costCenters}
        categories={categories}
        catalogItems={catalogItems}
        committedByCostCenter={committedByCostCenter}
      />
    </div>
  );
}
