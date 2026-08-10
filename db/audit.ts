import type { db } from "./client";
import { auditLog } from "./schema";

/**
 * Writes one audit_log row inside the caller's existing transaction — pass
 * the `tx` handle from inside a withTenant() callback, not the top-level
 * db. Same transaction means the audit entry and the mutation it describes
 * commit or roll back together; there's no window where one exists
 * without the other.
 */
export async function logAction(
  tx: typeof db,
  params: {
    tenantId: string;
    actorUserId?: string | null;
    action: string;
    entityType: string;
    entityId: string;
    metadata?: Record<string, unknown>;
  },
) {
  await tx.insert(auditLog).values({
    tenantId: params.tenantId,
    actorUserId: params.actorUserId ?? null,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    metadata: params.metadata ?? {},
  });
}
