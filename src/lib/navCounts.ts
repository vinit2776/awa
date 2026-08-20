import { cache } from "react";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/withTenant";
import { listMyQueries } from "@/db/clarifications";
import { isBlocked } from "@/db/clarificationRules";
import {
  purchaseRequisitions as purchaseRequisitionsTable,
  requisitionApprovalRequirements as requirementsTable,
  purchaseOrders as purchaseOrdersTable,
  invoices as invoicesTable,
  paymentInstructions as paymentInstructionsTable,
  departments as departmentsTable,
  costCenters as costCentersTable,
  roles as rolesTable,
  users as usersTable,
  userRoles as userRolesTable,
  approvalRules as approvalRulesTable,
} from "@/db/schema";

export type NavCounts = {
  myRequests: number;
  waitingOnMe: number;
  queries: number;
  sourcing: number;
  fulfillment: number;
  invoices: number;
  payments: number;
};

const TERMINAL_OR_DRAFT = ["draft", "rejected_closed", "cancelled"];

/**
 * Sidebar badge counts. Same aggregations dashboard/page.tsx already
 * computes for "Waiting on you" and the shared queues — extracted here
 * so the sidebar (rendered in the layout, on every navigation) and the
 * home page share one implementation instead of drifting. Wrapped in
 * React's cache() so a single request that renders both (a full page
 * load) queries once, not twice.
 */
export const getNavCounts = cache(async function getNavCounts(
  tenantId: string,
  userId: string,
): Promise<NavCounts> {
  const { askedOfMe } = await listMyQueries();
  const queries = askedOfMe.filter((q) => q.clarification.status === "open").length;

  return withTenant(tenantId, async (tx) => {
    const myRequisitions = await tx
      .select()
      .from(purchaseRequisitionsTable)
      .where(eq(purchaseRequisitionsTable.requestorId, userId));
    const myRequests = myRequisitions.filter((r) => !TERMINAL_OR_DRAFT.includes(r.status)).length;

    const pendingRequirements = await tx.select().from(requirementsTable).where(eq(requirementsTable.status, "pending"));
    const requisitionsInApproval = await tx
      .select()
      .from(purchaseRequisitionsTable)
      .where(eq(purchaseRequisitionsTable.status, "pending_approval"));
    const inApprovalIds = new Set(requisitionsInApproval.map((r) => r.id));

    // Same rule as the approvals inbox: only the lowest-numbered pending
    // group is actionable, and a group held by an open blocking query
    // is waiting on whoever was asked, not on the approver.
    const currentGroupFor = new Map<string, number>();
    for (const req of pendingRequirements) {
      const current = currentGroupFor.get(req.requisitionId);
      if (current === undefined || req.groupNo < current) currentGroupFor.set(req.requisitionId, req.groupNo);
    }
    const myPending = pendingRequirements.filter(
      (req) =>
        req.assignedUserId === userId &&
        inApprovalIds.has(req.requisitionId) &&
        currentGroupFor.get(req.requisitionId) === req.groupNo,
    );
    let waitingOnMe = 0;
    for (const req of myPending) {
      if (!(await isBlocked(tx, "requisition", req.requisitionId))) waitingOnMe += 1;
    }

    const allRequisitions = await tx.select().from(purchaseRequisitionsTable);
    const purchaseOrders = await tx.select().from(purchaseOrdersTable);
    const invoiceRows = await tx.select().from(invoicesTable);
    const payments = await tx.select().from(paymentInstructionsTable);

    return {
      myRequests,
      waitingOnMe,
      queries,
      sourcing: allRequisitions.filter((r) => r.status === "approved").length,
      fulfillment: purchaseOrders.filter((p) => p.status === "issued" || p.status === "partially_fulfilled").length,
      invoices: invoiceRows.filter((i) => i.status !== "paid").length,
      payments: payments.filter((p) => p.status === "queued" || p.status === "failed").length,
    };
  });
});

/**
 * "N of 4 done" for the sidebar's pinned "Start here" row — the same
 * four required steps admin/page.tsx tracks (vendors is optional there
 * and left out of this caption for the same reason). A smaller version
 * of that page's own query, not a new source of truth: if the two ever
 * disagree, admin/page.tsx's full step list wins.
 */
export const getAdminSetupProgress = cache(async function getAdminSetupProgress(
  tenantId: string,
): Promise<{ done: number; required: number }> {
  return withTenant(tenantId, async (tx) => {
    const [departments, costCenters, roles, users, userRoles, approvalRules] = await Promise.all([
      tx.select().from(departmentsTable),
      tx.select().from(costCentersTable),
      tx.select().from(rolesTable),
      tx.select().from(usersTable),
      tx.select().from(userRolesTable),
      tx.select().from(approvalRulesTable),
    ]);

    const budgetedCostCentres = costCenters.filter((c) => c.annualBudget !== null);
    const usersWithARole = new Set(userRoles.map((r) => r.userId));

    const done = [
      departments.length > 0,
      costCenters.length > 0 && budgetedCostCentres.length === costCenters.length,
      roles.length > 0,
      users.length > 1 && users.every((u) => usersWithARole.has(u.id)),
      approvalRules.some((r) => r.active),
    ].filter(Boolean).length;

    return { done, required: 5 };
  });
});
