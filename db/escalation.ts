import { and, eq, isNull, sql } from "drizzle-orm";
import type { db } from "./client";
import { logAction } from "./audit";
import { notifyUser } from "./notifications";
import { requisitionApprovalRequirements, roles, userRoles } from "./schema";

/**
 * The escalation engine (lifecycle audit, §08). Called once per tenant
 * — inside that tenant's withTenant scope, by the cron route — against
 * every pending approval requirement that's been actionable (see
 * actionableAt in db/approvals.ts) longer than the tenant's SLA and
 * hasn't already been escalated. Notifies whoever holds the
 * tenant_admin role (the one role every tenant is guaranteed to have,
 * see db/seedDefaultRoles.ts) rather than inventing a separate
 * escalation-contact concept that would need its own admin UI.
 *
 * Idempotent: escalated_at is stamped on the way out, so re-running
 * this on the next cron tick only picks up genuinely new breaches.
 */
export async function escalateStalePendingApprovals(tx: typeof db, tenantId: string, slaHours: number): Promise<number> {
  if (slaHours <= 0) return 0; // escalation disabled for this tenant

  const stale = await tx
    .select({
      id: requisitionApprovalRequirements.id,
      requisitionId: requisitionApprovalRequirements.requisitionId,
      assignedUserId: requisitionApprovalRequirements.assignedUserId,
      actionableAt: requisitionApprovalRequirements.actionableAt,
    })
    .from(requisitionApprovalRequirements)
    .where(
      and(
        eq(requisitionApprovalRequirements.status, "pending"),
        isNull(requisitionApprovalRequirements.escalatedAt),
        sql`${requisitionApprovalRequirements.actionableAt} is not null`,
        sql`${requisitionApprovalRequirements.actionableAt} < now() - (${slaHours} || ' hours')::interval`,
      ),
    );

  if (stale.length === 0) return 0;

  const admins = await tx
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(and(eq(roles.tenantId, tenantId), eq(roles.key, "tenant_admin")));

  for (const row of stale) {
    await tx
      .update(requisitionApprovalRequirements)
      .set({ escalatedAt: new Date() })
      .where(eq(requisitionApprovalRequirements.id, row.id));

    await logAction(tx, {
      tenantId,
      action: "requisition_approval.escalated",
      entityType: "requisition_approval_requirement",
      entityId: row.id,
      metadata: { requisitionId: row.requisitionId, assignedUserId: row.assignedUserId, slaHours },
    });

    for (const admin of admins) {
      await notifyUser(
        tx,
        admin.userId,
        "approval_escalated",
        "An approval has been waiting too long",
        `A requisition has been pending approval for more than ${slaHours} hours without a decision.`,
      );
    }
  }

  return stale.length;
}
