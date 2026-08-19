import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "../adminClient";
import { withTenant } from "../withTenant";
import { findSimilarCatalogItems } from "../catalogMatch";
import { catalogItems, tenants } from "../schema";

/**
 * findSimilarCatalogItems is a *recall* stage only — see its docblock.
 * These tests check it catches the real same-item pairs (measured on the
 * dev DB, see catalogMatch.ts) as candidates worth judging; they do not,
 * and must not, assert anything about similarity() being high enough to
 * decide identity on its own — that's exactly the mistake the docblock
 * documents as unfixable by tuning.
 */

let tenant: typeof tenants.$inferSelect;
let bearing6205: typeof catalogItems.$inferSelect;
let bearing6305: typeof catalogItems.$inferSelect;
let paper: typeof catalogItems.$inferSelect;
let tv: typeof catalogItems.$inferSelect;
let unrelated: typeof catalogItems.$inferSelect;
let mergedBearing: typeof catalogItems.$inferSelect;

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  [tenant] = await adminDb.insert(tenants).values({ name: "Catalog Match Co", slug: `catalog-match-co-${suffix}` }).returning();

  await withTenant(tenant.id, async (tx) => {
    [bearing6205] = await tx.insert(catalogItems).values({ tenantId: tenant.id, name: "Bearing, SKF 6205" }).returning();
    [bearing6305] = await tx.insert(catalogItems).values({ tenantId: tenant.id, name: "Bearing, SKF 6305" }).returning();
    [paper] = await tx.insert(catalogItems).values({ tenantId: tenant.id, name: "Copier paper A4 75gsm" }).returning();
    [tv] = await tx.insert(catalogItems).values({ tenantId: tenant.id, name: "Toshiba 55in LED TV" }).returning();
    [unrelated] = await tx.insert(catalogItems).values({ tenantId: tenant.id, name: "Fire extinguisher, 5kg CO2" }).returning();
    [mergedBearing] = await tx
      .insert(catalogItems)
      .values({ tenantId: tenant.id, name: "Bearing SKF 6205 (dup)", status: "merged" })
      .returning();
  });
});

afterAll(async () => {
  await adminDb.delete(catalogItems).where(eq(catalogItems.tenantId, tenant.id));
  await adminDb.delete(tenants).where(eq(tenants.id, tenant.id));
});

describe("findSimilarCatalogItems", () => {
  it("recalls a close variant with heavy vendor wording (bearing)", async () => {
    const results = await withTenant(tenant.id, (tx) =>
      findSimilarCatalogItems(tx, "Deep groove ball bearing SKF 6205-2RSH", 5),
    );
    expect(results.some((r) => r.id === bearing6205.id)).toBe(true);
  });

  it("recalls a close variant with heavy vendor wording (paper)", async () => {
    const results = await withTenant(tenant.id, (tx) =>
      findSimilarCatalogItems(tx, "JK Copier A4 Paper 75 GSM 500 sheets ream", 5),
    );
    expect(results.some((r) => r.id === paper.id)).toBe(true);
  });

  it("recalls a close variant with heavy vendor wording (TV) — the codebase's own worked example (db/documentExtraction.ts)", async () => {
    const results = await withTenant(tenant.id, (tx) =>
      findSimilarCatalogItems(tx, "55RTREHDY Toshiba 55 inch LED Television", 5),
    );
    expect(results.some((r) => r.id === tv.id)).toBe(true);
  });

  it("also recalls a same-wording-but-different-part-number item as a candidate — deciding it's different is the judge's job, not recall's", async () => {
    const results = await withTenant(tenant.id, (tx) => findSimilarCatalogItems(tx, "Bearing, SKF 6205", 5));
    expect(results.some((r) => r.id === bearing6305.id)).toBe(true);
  });

  it("does not recall an unrelated description", async () => {
    const results = await withTenant(tenant.id, (tx) => findSimilarCatalogItems(tx, "SKF 6205 bearing", 5));
    expect(results.some((r) => r.id === unrelated.id)).toBe(false);
  });

  it("excludes merged items even when they'd otherwise be the closest match", async () => {
    const results = await withTenant(tenant.id, (tx) => findSimilarCatalogItems(tx, "Bearing SKF 6205 dup", 5));
    expect(results.some((r) => r.id === mergedBearing.id)).toBe(false);
  });

  it("orders results by similarity, most similar first", async () => {
    const results = await withTenant(tenant.id, (tx) => findSimilarCatalogItems(tx, "SKF 6205 bearing", 5));
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].similarity).toBeGreaterThanOrEqual(results[i].similarity);
    }
  });
});
