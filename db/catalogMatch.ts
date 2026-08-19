import { and, ne, sql } from "drizzle-orm";
import type { db } from "./client";
import { catalogItems, type catalogItemStatus } from "./schema";

export type SimilarCatalogItem = {
  id: string;
  name: string;
  uom: string;
  categoryId: string | null;
  // `status` is only ever "unverified" | "verified" here — "merged" is
  // filtered out below — but the admin "did you mean…" hint (the other
  // caller of this function, via searchSimilarItems) displays it, so it
  // rides along even though the proactive line-suggestion caller ignores it.
  status: Exclude<(typeof catalogItemStatus.enumValues)[number], "merged">;
  similarity: number;
};

/**
 * Trigram similarity lookup against catalog_items.name — a *recall* stage
 * only. It answers "which catalogue items are worth a closer look", not
 * "which one is actually the same item". Backs two different callers: the
 * admin "did you mean…" hint on the new-item form
 * (src/app/dashboard/admin/catalog/actions.ts), which shows the candidate
 * list straight to a human who then judges it themselves, and the
 * requester-facing proactive suggestion on requisition lines
 * (suggestCatalogItemForLine in src/app/dashboard/requisitions/actions.ts),
 * which feeds these candidates to an LLM judge (db/catalogMatchJudge.ts)
 * before ever showing one to anyone. Both need the same notion of "close
 * enough to be worth considering", so it's defined once here.
 *
 * IMPORTANT — do not use `similarity` to decide identity, at any threshold,
 * with any pg_trgm function (`similarity`, `word_similarity`,
 * `strict_word_similarity` all measured the same way). Real procurement
 * pairs were measured on the dev DB and no cutoff separates same-item from
 * different-item:
 *   - "Bearing, SKF 6205" vs "Deep groove ball bearing SKF 6205-2RSH"
 *     (same item) scores 0.447
 *   - "Bearing, SKF 6205" vs "Bearing, SKF 6305" (different item — 6205 is
 *     not 6305) scores 0.700
 * A different part number/model/grade/size is exactly the kind of
 * one-or-two-character difference trigrams are least sensitive to, because
 * it's swamped by shared surrounding words. This is structural, not a
 * tuning problem — see db/catalogMatchJudge.ts, which exists specifically
 * to make that call instead.
 *
 * Uses the `%` operator so Postgres can use the pg_trgm GIN index on
 * catalog_items.name (db/migrations/0001_init.sql) instead of scanning
 * every row and computing similarity() for each — `%` filters by the
 * session's pg_trgm.similarity_threshold (left at its default of 0.3;
 * measurements show 0.3 comfortably recalls same-item pairs, it's only
 * being used to decide identity that doesn't work) before the exact
 * similarity() is computed for ordering.
 *
 * `merged` items are excluded: a merged item has been superseded by its
 * canonical target, so pointing a new line at it would just mean
 * re-resolving the merge later. Tenant scoping is left to RLS via
 * withTenant, same as db/itemHistory.ts — no manual tenant_id filter here.
 */
export async function findSimilarCatalogItems(
  tx: typeof db,
  description: string,
  limit: number,
): Promise<SimilarCatalogItem[]> {
  const trimmed = description.trim();
  if (trimmed.length < 2) return [];

  const rows = await tx
    .select({
      id: catalogItems.id,
      name: catalogItems.name,
      uom: catalogItems.uom,
      categoryId: catalogItems.categoryId,
      status: catalogItems.status,
      similarity: sql<number>`similarity(${catalogItems.name}, ${trimmed})`,
    })
    .from(catalogItems)
    .where(and(sql`${catalogItems.name} % ${trimmed}`, ne(catalogItems.status, "merged")))
    .orderBy(sql`similarity(${catalogItems.name}, ${trimmed}) desc`)
    .limit(limit);

  // The WHERE clause above already excludes "merged", so this narrowing
  // is safe at runtime — Drizzle just can't express "not merged" in the
  // column's inferred type from a runtime `ne()` filter.
  return rows as SimilarCatalogItem[];
}
