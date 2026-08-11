import { and, eq, inArray, sql } from "drizzle-orm";
import type { db } from "./client";
import { auditLog, purchaseRequisitions, departments } from "./schema";

// Both actions mark the moment a requisition cleared approval — the
// audit_log row (db/approvals.ts) is the only reliable timestamp for
// that: purchase_requisitions has no dedicated "approved_at" column, and
// updated_at gets overwritten by whatever happens to the requisition
// next (e.g. converting to a PO), so it can't be trusted for "when was
// this approved" once a requisition moves further along.
const APPROVAL_ACTIONS = ["requisition.approved", "requisition.auto_approved"] as const;

export type ApprovalsReport = {
  totalValue: number;
  totalCount: number;
  timeline: { month: string; value: number; count: number }[];
  byDepartment: { departmentId: string | null; departmentName: string; value: number; count: number }[];
};

export async function getApprovalsReport(tx: typeof db): Promise<ApprovalsReport> {
  const approvalJoin = tx
    .select({
      requisitionId: purchaseRequisitions.id,
      value: purchaseRequisitions.totalEstimatedValue,
      departmentId: purchaseRequisitions.departmentId,
      approvedAt: auditLog.occurredAt,
    })
    .from(auditLog)
    .innerJoin(purchaseRequisitions, eq(purchaseRequisitions.id, auditLog.entityId))
    .where(and(eq(auditLog.entityType, "purchase_requisition"), inArray(auditLog.action, APPROVAL_ACTIONS)))
    .as("approvals");

  const timelineRows = await tx
    .select({
      month: sql<string>`to_char(date_trunc('month', ${approvalJoin.approvedAt}), 'YYYY-MM')`,
      value: sql<string>`coalesce(sum(${approvalJoin.value}), 0)`,
      count: sql<number>`count(*)::int`,
    })
    .from(approvalJoin)
    .groupBy(sql`date_trunc('month', ${approvalJoin.approvedAt})`)
    .orderBy(sql`date_trunc('month', ${approvalJoin.approvedAt})`);

  const departmentRows = await tx
    .select({
      departmentId: approvalJoin.departmentId,
      departmentName: departments.name,
      value: sql<string>`coalesce(sum(${approvalJoin.value}), 0)`,
      count: sql<number>`count(*)::int`,
    })
    .from(approvalJoin)
    .leftJoin(departments, eq(departments.id, approvalJoin.departmentId))
    .groupBy(approvalJoin.departmentId, departments.name)
    .orderBy(sql`sum(${approvalJoin.value}) desc`);

  const timeline = timelineRows.map((r) => ({ month: r.month, value: Number(r.value), count: r.count }));
  const byDepartment = departmentRows.map((r) => ({
    departmentId: r.departmentId,
    departmentName: r.departmentName ?? "No department",
    value: Number(r.value),
    count: r.count,
  }));

  return {
    totalValue: timeline.reduce((sum, r) => sum + r.value, 0),
    totalCount: timeline.reduce((sum, r) => sum + r.count, 0),
    timeline,
    byDepartment,
  };
}
