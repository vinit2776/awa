import { and, eq, inArray } from "drizzle-orm";
import type { db } from "./client";
import { transactionClarifications } from "./schema";

/**
 * The auth-free half of the clarification logic.
 *
 * Deliberately separate from db/clarifications.ts, for the same reason
 * db/platformAdmins.ts is separate from db/platformSession.ts: that file
 * imports getCurrentUserAndTenant, which reaches withAuth in
 * @workos-inc/authkit-nextjs, which pulls in next/cache at module load and
 * cannot resolve outside Next's own runtime. Any vitest file that imports it —
 * even indirectly, even for one pure function — fails at import time.
 *
 * Everything here takes a `tx` and plain ids, so it is callable from a test, a
 * server action, or another db module without dragging auth along.
 */

export type ClarificationEntityType =
  | "requisition" | "purchase_order" | "invoice" | "goods_receipt" | "quotation";

export type ClarificationStatus = "open" | "answered" | "resolved" | "withdrawn";

/** Open in the sense that matters: still awaiting the asker's sign-off. */
export const LIVE_STATUSES: ClarificationStatus[] = ["open", "answered"];

/**
 * Does an open blocking query exist on this record?
 *
 * Derived, never stored — which is why a blocking query needs no 'on_hold'
 * value on requisition_status. "Blocked" is a property of there existing an
 * open question, so computing it means it can never go stale and no code path
 * can forget to clear it. Adding a status instead would ripple through the
 * approval engine, the lifecycle tracker and the golden-path test.
 */
export async function isBlocked(
  tx: typeof db,
  entityType: ClarificationEntityType,
  entityId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ id: transactionClarifications.id })
    .from(transactionClarifications)
    .where(
      and(
        eq(transactionClarifications.entityType, entityType),
        eq(transactionClarifications.entityId, entityId),
        eq(transactionClarifications.blocksProgress, true),
        inArray(transactionClarifications.status, LIVE_STATUSES),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
