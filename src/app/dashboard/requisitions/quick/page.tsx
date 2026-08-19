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
import { QuickPurchaseForm } from "./QuickPurchaseForm";

export default async function QuickPurchasePage() {
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
            { label: "Quick purchase" },
          ]}
        />
        <div>
          <h1 className="font-serif text-lg text-foreground">Quick purchase</h1>
          <p className="text-sm text-muted-foreground">A simple, single-line ask — no document, no steps.</p>
        </div>
      </div>
      <QuickPurchaseForm
        departments={departments}
        costCenters={costCenters}
        categories={categories}
        catalogItems={catalogItems}
        committedByCostCenter={committedByCostCenter}
      />
    </div>
  );
}
