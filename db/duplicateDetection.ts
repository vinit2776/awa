import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { db } from "./client";
import { logAction } from "./audit";
import {
  purchaseRequisitions,
  purchaseRequisitionLines,
  requisitionDuplicateAcknowledgements,
  users,
} from "./schema";

export type DuplicateMatchedItem = {
  catalogItemId: string;
  quantity: string;
  uom: string;
};

export type PossibleDuplicate = {
  requisitionId: string;
  requestorName: string;
  status: "submitted" | "pending_approval" | "approved" | "converted_to_po";
  submittedAt: Date | null;
  matchedItems: DuplicateMatchedItem[];
};

/**
 * "Somebody may already have asked for this" (S20 brief): a paper process
 * duplicates requests constantly, and this is the check that catches it —
 * warn, record, and never block. A hard block on a fuzzy match teaches
 * people to route around the system, which costs more than the duplicates
 * do, so this is deliberately advisory: callers decide what to do with the
 * result, nothing here rejects a requisition.
 *
 * Takes plain values (catalogItemIds, excludeRequisitionId), not a
 * requisition row — same reasoning as db/approvalPreview.ts: this runs on
 * the review step before any requisition exists (there is no row to read
 * yet), and again at submit, and the two calls must run the exact same
 * code or the review step starts lying about what submit will find.
 *
 * A requisition is a possible duplicate when it shares at least one
 * catalogue item and is still live:
 *   - status is 'submitted', 'pending_approval' or 'approved'; or
 *   - status is 'converted_to_po' AND its purchase order is neither
 *     'fulfilled' nor 'cancelled' — ordered but not fully arrived yet. This
 *     is the strongest duplicate case of all ("you ordered this last week,
 *     it's still coming"), so it must not be missed just because the
 *     requisition itself has moved on to a different status.
 *
 * Excluded: the requisition itself (excludeRequisitionId), 'draft' (nobody
 * else has seen it), 'cancelled', 'rejected_closed', and
 * 'rejected_revisable' — sent back to the requester, who must revise and
 * resubmit before it is live again. Same exclusion list db/itemCommitments.ts
 * uses for its pipeline figure, for the same reason.
 *
 * Matching is on catalog_item_id only. Do NOT fuzzy-match free text.
 * Commit a95cd63 measured trigram similarity against real procurement
 * wording and it fails in the worst possible direction: it scored a
 * DIFFERENT bearing (SKF 6305 vs SKF 6205) higher than genuine matches
 * wearing normal vendor verbiage. A false duplicate warning is exactly as
 * damaging as a missed one — it trains people to click through warnings
 * without reading them. A free-text line that never acquired a catalogue
 * identity (via that same commit's suggestion flow) simply yields no
 * match here; that is the honest answer, not a guessed one. Do not
 * "improve" this with a similarity threshold — it was tried and it does
 * not work; see a95cd63's commit message for the measurements.
 */
export async function findPossibleDuplicates(
  tx: typeof db,
  params: { catalogItemIds: string[]; excludeRequisitionId: string | null },
): Promise<PossibleDuplicate[]> {
  const catalogItemIds = [...new Set(params.catalogItemIds.filter(Boolean))];
  if (catalogItemIds.length === 0) return [];

  const rows = await tx
    .select({
      requisitionId: purchaseRequisitionLines.requisitionId,
      catalogItemId: purchaseRequisitionLines.catalogItemId,
      quantity: purchaseRequisitionLines.quantity,
      uom: purchaseRequisitionLines.uom,
      status: purchaseRequisitions.status,
      submittedAt: purchaseRequisitions.submittedAt,
      requestorName: users.fullName,
    })
    .from(purchaseRequisitionLines)
    .innerJoin(purchaseRequisitions, eq(purchaseRequisitions.id, purchaseRequisitionLines.requisitionId))
    .innerJoin(users, eq(users.id, purchaseRequisitions.requestorId))
    .where(
      and(
        inArray(purchaseRequisitionLines.catalogItemId, catalogItemIds),
        params.excludeRequisitionId ? ne(purchaseRequisitions.id, params.excludeRequisitionId) : undefined,
        or(
          inArray(purchaseRequisitions.status, ["submitted", "pending_approval", "approved"]),
          and(
            eq(purchaseRequisitions.status, "converted_to_po"),
            // A subquery rather than a join, so a requisition with several
            // purchase orders (or several matching lines) doesn't fan out
            // into duplicate rows that would then need de-duplicating —
            // "is there still an open PO" is a yes/no question per
            // requisition, not something to join and re-aggregate.
            sql`exists (
              select 1 from purchase_orders po
              where po.requisition_id = ${purchaseRequisitions.id}
                and po.status not in ('fulfilled', 'cancelled')
            )`,
          ),
        ),
      ),
    );

  const byRequisition = new Map<string, PossibleDuplicate>();
  for (const row of rows) {
    if (!row.catalogItemId) continue; // inArray already excludes nulls, but keep the type narrow below.
    let entry = byRequisition.get(row.requisitionId);
    if (!entry) {
      entry = {
        requisitionId: row.requisitionId,
        requestorName: row.requestorName,
        status: row.status as PossibleDuplicate["status"],
        submittedAt: row.submittedAt,
        matchedItems: [],
      };
      byRequisition.set(row.requisitionId, entry);
    }
    entry.matchedItems.push({ catalogItemId: row.catalogItemId, quantity: row.quantity, uom: row.uom });
  }

  return [...byRequisition.values()];
}

/**
 * Records a requester's "no, this is a different purchase" answer to one
 * or more possible-duplicate warnings raised by findPossibleDuplicates().
 * This is the whole point of the feature: a soft nudge with no record
 * behind it teaches people to click past it; a recorded reason is what an
 * approver can actually weigh.
 *
 * Shaped to be called from inside createRequisition's existing
 * withTenant() transaction in src/app/dashboard/requisitions/actions.ts,
 * alongside its logAction() call — same tx, same requisitionId already in
 * scope, one acknowledgement row (and one audit-log entry) per duplicate
 * the requester dismissed. Not wired in there yet; that's pass 2.
 */
export async function recordDuplicateAcknowledgements(
  tx: typeof db,
  params: {
    tenantId: string;
    requisitionId: string;
    acknowledgedByUserId: string;
    acknowledgements: { duplicateOfRequisitionId: string; reason: string }[];
  },
): Promise<void> {
  if (params.acknowledgements.length === 0) return;

  await tx.insert(requisitionDuplicateAcknowledgements).values(
    params.acknowledgements.map((ack) => ({
      tenantId: params.tenantId,
      requisitionId: params.requisitionId,
      duplicateOfRequisitionId: ack.duplicateOfRequisitionId,
      acknowledgedByUserId: params.acknowledgedByUserId,
      reason: ack.reason,
    })),
  );

  for (const ack of params.acknowledgements) {
    await logAction(tx, {
      tenantId: params.tenantId,
      actorUserId: params.acknowledgedByUserId,
      action: "requisition.duplicate_acknowledged",
      entityType: "purchase_requisition",
      entityId: params.requisitionId,
      metadata: { duplicateOfRequisitionId: ack.duplicateOfRequisitionId, reason: ack.reason },
    });
  }
}
