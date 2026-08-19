import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { getCommittedByCostCenter } from "@/db/budget";
import {
  departments as departmentsTable,
  costCenters as costCentersTable,
  catalogCategories as catalogCategoriesTable,
  catalogItems as catalogItemsTable,
} from "@/db/schema";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { RequisitionForm } from "../RequisitionForm";

export default async function NewRequisitionPage() {
  const { tenant } = await getCurrentUserAndTenant();

  const [departments, costCenters, categories, catalogItems, committedByCostCenter] = await withTenant(
    tenant.id,
    async (tx) => [
      await tx.select().from(departmentsTable),
      await tx.select().from(costCentersTable),
      await tx.select().from(catalogCategoriesTable),
      await tx.select().from(catalogItemsTable),
      await getCommittedByCostCenter(tx),
    ],
  );

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex flex-col gap-2">
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Requisitions", href: "/dashboard/requisitions" },
            { label: "New requisition" },
          ]}
        />
        <div>
          <h1 className="font-serif text-lg text-foreground">New requisition</h1>
          <p className="text-sm text-muted-foreground">{tenant.name}</p>
        </div>
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
