import { notInArray, sql } from "drizzle-orm";
import type { db } from "./client";
import { purchaseRequisitions } from "./schema";

// Requisitions in these statuses don't consume budget — a draft isn't a
// commitment yet, and a cancelled/closed-rejected one never became one.
const NON_COMMITTED_STATUSES: ("draft" | "cancelled" | "rejected_closed")[] = [
  "draft",
  "cancelled",
  "rejected_closed",
];

/**
 * Shared between the requisition creation form (S4) and the approver
 * decision-support panel (S13) — both need the same "what's already
 * spoken for against this cost center" figure, and it needs to stay
 * defined once so the two views can't quietly drift apart.
 */
export async function getCommittedByCostCenter(tx: typeof db): Promise<Record<string, number>> {
  const rows = await tx
    .select({
      costCenterId: purchaseRequisitions.costCenterId,
      committed: sql<string>`coalesce(sum(${purchaseRequisitions.totalEstimatedValue}), 0)`,
    })
    .from(purchaseRequisitions)
    .where(notInArray(purchaseRequisitions.status, NON_COMMITTED_STATUSES))
    .groupBy(purchaseRequisitions.costCenterId);

  return Object.fromEntries(rows.filter((r) => r.costCenterId).map((r) => [r.costCenterId as string, Number(r.committed)]));
}
