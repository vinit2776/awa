import { notFound } from "next/navigation";
import { and, desc, eq, notInArray, sql } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import {
  purchaseRequisitions as purchaseRequisitionsTable,
  purchaseRequisitionLines as purchaseRequisitionLinesTable,
  requisitionApprovalRequirements as requirementsTable,
  departments as departmentsTable,
  costCenters as costCentersTable,
  catalogCategories as catalogCategoriesTable,
  catalogItems as catalogItemsTable,
} from "@/db/schema";
import { RequisitionForm } from "../../RequisitionForm";

const NON_COMMITTED_STATUSES: ("draft" | "cancelled" | "rejected_closed")[] = [
  "draft",
  "cancelled",
  "rejected_closed",
];

export default async function EditRequisitionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, tenant } = await getCurrentUserAndTenant();

  const [requisition, lines, rejection, departments, costCenters, categories, catalogItems, committedRows] =
    await withTenant(tenant.id, async (tx) => {
      const [requisition] = await tx
        .select()
        .from(purchaseRequisitionsTable)
        .where(
          and(
            eq(purchaseRequisitionsTable.id, id),
            eq(purchaseRequisitionsTable.requestorId, user.id),
            eq(purchaseRequisitionsTable.status, "rejected_revisable"),
          ),
        );
      if (!requisition) return [null, [], null, [], [], [], [], []] as const;

      const lines = await tx
        .select()
        .from(purchaseRequisitionLinesTable)
        .where(eq(purchaseRequisitionLinesTable.requisitionId, id));

      const [rejection] = await tx
        .select({ comment: requirementsTable.decisionComment })
        .from(requirementsTable)
        .where(and(eq(requirementsTable.requisitionId, id), eq(requirementsTable.status, "rejected")))
        .orderBy(desc(requirementsTable.decidedAt))
        .limit(1);

      const departments = await tx.select().from(departmentsTable);
      const costCenters = await tx.select().from(costCentersTable);
      const categories = await tx.select().from(catalogCategoriesTable);
      const catalogItems = await tx.select().from(catalogItemsTable);
      const committedRows = await tx
        .select({
          costCenterId: purchaseRequisitionsTable.costCenterId,
          committed: sql<string>`coalesce(sum(${purchaseRequisitionsTable.totalEstimatedValue}), 0)`,
        })
        .from(purchaseRequisitionsTable)
        .where(notInArray(purchaseRequisitionsTable.status, NON_COMMITTED_STATUSES))
        .groupBy(purchaseRequisitionsTable.costCenterId);

      return [requisition, lines, rejection ?? null, departments, costCenters, categories, catalogItems, committedRows] as const;
    });

  if (!requisition) notFound();

  const committedByCostCenter = Object.fromEntries(
    committedRows.filter((r) => r.costCenterId).map((r) => [r.costCenterId as string, Number(r.committed)]),
  );

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <h1 className="text-lg font-medium">Revise requisition</h1>
        <p className="text-sm text-muted-foreground">{tenant.name}</p>
        {rejection?.comment && (
          <p className="mt-2 max-w-2xl rounded-md border border-amber-500 p-3 text-sm">
            Rejected: {rejection.comment}
          </p>
        )}
      </div>
      <RequisitionForm
        departments={departments}
        costCenters={costCenters}
        categories={categories}
        catalogItems={catalogItems}
        committedByCostCenter={committedByCostCenter}
        revision={{
          requisitionId: requisition.id,
          initial: {
            departmentId: requisition.departmentId,
            costCenterId: requisition.costCenterId,
            justification: requisition.justification ?? "",
            lines: lines.map((l) => ({
              catalogItemId: l.catalogItemId,
              freeTextDescription: l.freeTextDescription,
              categoryId: l.categoryId,
              fulfillmentType: l.fulfillmentType,
              quantity: l.quantity,
              uom: l.uom,
              estimatedUnitPrice: l.estimatedUnitPrice,
            })),
          },
        }}
      />
    </div>
  );
}
