"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { logAction } from "@/db/audit";
import { catalogCategories, catalogItems } from "@/db/schema";

export async function createCategory(formData: FormData) {
  const { user, tenant } = await getCurrentUserAndTenant();
  const name = String(formData.get("name") ?? "").trim();
  const parentCategoryId = String(formData.get("parentCategoryId") ?? "").trim() || null;
  const assetEligible = formData.get("assetEligible") === "on";
  const assetValueThreshold = String(formData.get("assetValueThreshold") ?? "").trim() || null;
  if (!name) return;

  await withTenant(tenant.id, async (tx) => {
    const [created] = await tx
      .insert(catalogCategories)
      .values({ tenantId: tenant.id, name, parentCategoryId, assetEligible, assetValueThreshold })
      .returning();
    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "catalog_category.created",
      entityType: "catalog_category",
      entityId: created.id,
      metadata: { name },
    });
  });

  revalidatePath("/dashboard/admin/catalog");
}

export async function createItem(formData: FormData) {
  const { user, tenant } = await getCurrentUserAndTenant();
  const name = String(formData.get("name") ?? "").trim();
  const categoryId = String(formData.get("categoryId") ?? "").trim() || null;
  const uom = String(formData.get("uom") ?? "").trim() || "each";
  if (!name) return;

  await withTenant(tenant.id, async (tx) => {
    const [created] = await tx
      .insert(catalogItems)
      .values({ tenantId: tenant.id, name, categoryId, uom, createdBy: user.id })
      .returning();
    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "catalog_item.created",
      entityType: "catalog_item",
      entityId: created.id,
      metadata: { name },
    });
  });

  revalidatePath("/dashboard/admin/catalog");
}

// Informational "did you mean…" hint only (§07) — no merge/dedup action
// yet, that's a later phase. Uses the pg_trgm gin index on catalog_items.name.
export async function searchSimilarItems(query: string) {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const { tenant } = await getCurrentUserAndTenant();

  return withTenant(tenant.id, async (tx) => {
    const rows = await tx
      .select({
        id: catalogItems.id,
        name: catalogItems.name,
        status: catalogItems.status,
        similarity: sql<number>`similarity(${catalogItems.name}, ${trimmed})`,
      })
      .from(catalogItems)
      .where(sql`${catalogItems.name} % ${trimmed}`)
      .orderBy(sql`similarity(${catalogItems.name}, ${trimmed}) desc`)
      .limit(5);
    return rows;
  });
}
