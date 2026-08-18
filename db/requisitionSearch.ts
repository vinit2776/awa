import { eq, ilike, or } from "drizzle-orm";
import type { db } from "./client";
import {
  purchaseRequisitions,
  purchaseRequisitionLines,
  catalogItems,
  departments,
  costCenters,
  users,
} from "./schema";

/**
 * Finding a requisition again.
 *
 * Until now there was no search anywhere in AWA, and a requisition has
 * no number and no title to search for even if there had been. What a
 * person actually remembers is one of: the thing they asked for, who
 * asked for it, which department or cost centre it was charged to, or a
 * phrase from the justification they typed. So all of those match.
 *
 * The joins are all LEFT: a requisition with no lines, no department or
 * no cost centre is still a requisition, and an inner join would make it
 * invisible to search — which is exactly the sort of quiet omission that
 * makes people stop trusting a search box.
 *
 * Returns ids rather than rows so the caller can intersect this with the
 * status and scope filters it already applies, instead of this function
 * having to know about them.
 */
export async function findRequisitionIdsMatching(tx: typeof db, query: string): Promise<string[]> {
  const trimmed = query.trim();
  if (trimmed === "") return [];

  // Escape LIKE wildcards so a literal % or _ in a product code searches
  // for itself rather than matching everything.
  const pattern = `%${trimmed.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

  const rows = await tx
    .selectDistinct({ id: purchaseRequisitions.id })
    .from(purchaseRequisitions)
    .leftJoin(purchaseRequisitionLines, eq(purchaseRequisitionLines.requisitionId, purchaseRequisitions.id))
    .leftJoin(catalogItems, eq(catalogItems.id, purchaseRequisitionLines.catalogItemId))
    .leftJoin(departments, eq(departments.id, purchaseRequisitions.departmentId))
    .leftJoin(costCenters, eq(costCenters.id, purchaseRequisitions.costCenterId))
    .leftJoin(users, eq(users.id, purchaseRequisitions.requestorId))
    .where(
      or(
        // What was asked for — typed free-text, or the catalogue's name for it.
        ilike(purchaseRequisitionLines.freeTextDescription, pattern),
        ilike(catalogItems.name, pattern),
        // Who asked, and what it was charged to.
        ilike(users.fullName, pattern),
        ilike(departments.name, pattern),
        ilike(costCenters.name, pattern),
        ilike(costCenters.code, pattern),
        // The notes the requester wrote.
        ilike(purchaseRequisitions.justification, pattern),
      ),
    );

  return rows.map((r) => r.id);
}

/** What the search box says it looks at, so the UI and this file can't drift apart. */
export const REQUISITION_SEARCH_FIELDS =
  "item, requester, department, cost centre, and the justification notes";

/**
 * Substring matching only. pg_trgm is installed (0001_init.sql) and already
 * indexes catalog_items.name, so a similarity() fallback for near-misses and
 * typos is available cheaply — deliberately not built yet, because picking a
 * similarity threshold before anyone has used this is how search gets worse
 * rather than better.
 */
