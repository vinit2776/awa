import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { catalogCategories, catalogItems } from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createCategory, createItem } from "./actions";
import { ItemNameField } from "./ItemNameField";

export default async function CatalogPage() {
  const { tenant } = await getCurrentUserAndTenant();

  const [categories, items] = await withTenant(tenant.id, async (tx) => [
    await tx.select().from(catalogCategories),
    await tx.select().from(catalogItems),
  ]);

  const categoryName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? "—";

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="font-serif text-lg text-foreground">Catalog</h1>
        <p className="text-sm text-muted-foreground">
          {categories.length} categories, {items.length} items in {tenant.name}
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Categories</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 font-normal">Name</th>
              <th className="py-2 font-normal">Parent</th>
              <th className="py-2 font-normal">Asset-eligible</th>
              <th className="py-2 font-normal">Asset value threshold</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.id} className="border-b">
                <td className="py-2">{c.name}</td>
                <td className="py-2">{categoryName(c.parentCategoryId)}</td>
                <td className="py-2">{c.assetEligible ? "Yes" : "No"}</td>
                <td className="py-2">{c.assetValueThreshold ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <form action={createCategory} className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="category-name" className="text-xs text-muted-foreground">New category</label>
            <input
              id="category-name"
              name="name"
              required
              className="h-8 rounded-md border px-2 text-sm"
              placeholder="e.g. Valves"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="parentCategoryId" className="text-xs text-muted-foreground">Parent</label>
            <select id="parentCategoryId" name="parentCategoryId" className="h-8 rounded-md border px-2 text-sm">
              <option value="">None</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <label className="flex h-8 items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" name="assetEligible" />
            Asset-eligible
          </label>
          <div className="flex flex-col gap-1">
            <label htmlFor="assetValueThreshold" className="text-xs text-muted-foreground">Asset value threshold</label>
            <input
              id="assetValueThreshold"
              name="assetValueThreshold"
              type="number"
              step="0.01"
              className="h-8 w-32 rounded-md border px-2 text-sm"
              placeholder="e.g. 5000"
            />
          </div>
          <button type="submit" className={cn(buttonVariants())}>Add</button>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Items</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 font-normal">Name</th>
              <th className="py-2 font-normal">Category</th>
              <th className="py-2 font-normal">UoM</th>
              <th className="py-2 font-normal">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="border-b">
                <td className="py-2">{i.name}</td>
                <td className="py-2">{categoryName(i.categoryId)}</td>
                <td className="py-2">{i.uom}</td>
                <td className="py-2">{i.status}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <form action={createItem} className="flex flex-wrap items-end gap-2">
          <ItemNameField />
          <div className="flex flex-col gap-1">
            <label htmlFor="categoryId" className="text-xs text-muted-foreground">Category</label>
            <select id="categoryId" name="categoryId" className="h-8 rounded-md border px-2 text-sm">
              <option value="">None</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="uom" className="text-xs text-muted-foreground">Unit of measure</label>
            <input
              id="uom"
              name="uom"
              defaultValue="each"
              className="h-8 w-24 rounded-md border px-2 text-sm"
            />
          </div>
          <button type="submit" className={cn(buttonVariants())}>Add</button>
        </form>
      </section>
    </div>
  );
}
