import { eq, inArray } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { getCommittedByCostCenter } from "@/db/budget";
import { getItemPurchaseHistory, type ItemPurchaseHistoryEntry } from "@/db/itemHistory";
import { getRequisitionDocumentUrl } from "@/db/documentStorage";
import {
  requisitionApprovalRequirements as requirementsTable,
  purchaseRequisitions as purchaseRequisitionsTable,
  purchaseRequisitionLines as purchaseRequisitionLinesTable,
  catalogItems as catalogItemsTable,
  users as usersTable,
  departments as departmentsTable,
  costCenters as costCentersTable,
  approvalRules as approvalRulesTable,
} from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { cn } from "@/lib/utils";
import { LifecycleStatus } from "@/app/dashboard/lifecycle/LifecycleStatus";
import { approvalStepDetail } from "@/app/dashboard/lifecycle/stage";
import { approveRequirement, requestRevision, rejectAndClose, addAdHocApprover } from "./actions";

function pendingDays(submittedAt: Date | null): number | null {
  if (!submittedAt) return null;
  return Math.floor((Date.now() - submittedAt.getTime()) / 86_400_000);
}

export default async function ApprovalsInboxPage() {
  const { user, tenant } = await getCurrentUserAndTenant();

  const [pendingRequirements, requisitions, users, departments, costCenters, committedByCostCenter] =
    await withTenant(tenant.id, async (tx) => [
      await tx.select().from(requirementsTable).where(eq(requirementsTable.status, "pending")),
      await tx.select().from(purchaseRequisitionsTable).where(eq(purchaseRequisitionsTable.status, "pending_approval")),
      await tx.select().from(usersTable),
      await tx.select().from(departmentsTable),
      await tx.select().from(costCentersTable),
      await getCommittedByCostCenter(tx),
    ]);

  const currentGroupByRequisition = new Map<string, number>();
  for (const req of pendingRequirements) {
    const current = currentGroupByRequisition.get(req.requisitionId);
    if (current === undefined || req.groupNo < current) {
      currentGroupByRequisition.set(req.requisitionId, req.groupNo);
    }
  }

  const requisitionById = new Map(requisitions.map((r) => [r.id, r]));
  const userName = (id: string | null) => users.find((u) => u.id === id)?.fullName ?? "—";
  const departmentName = (id: string | null) => departments.find((d) => d.id === id)?.name ?? "—";
  const costCenterName = (id: string | null) => costCenters.find((c) => c.id === id)?.name ?? "—";

  const myActionable = pendingRequirements.filter(
    (req) =>
      req.assignedUserId === user.id &&
      requisitionById.has(req.requisitionId) &&
      currentGroupByRequisition.get(req.requisitionId) === req.groupNo,
  );

  // Decision-support context (S13, §04): budget standing for each
  // requisition's cost center, and purchase history for each catalog
  // item on the line — only for what's actually in front of this
  // approver right now, not the whole catalog.
  const requisitionIds = myActionable.map((req) => req.requisitionId);
  const [lines, catalogItems] = requisitionIds.length
    ? await withTenant(tenant.id, async (tx) => [
        await tx.select().from(purchaseRequisitionLinesTable).where(inArray(purchaseRequisitionLinesTable.requisitionId, requisitionIds)),
        await tx.select().from(catalogItemsTable),
      ])
    : [[], []];

  // All requirement rows (any status, every group) for the requisitions
  // in front of this approver — not just the pending ones already
  // fetched above — so approvalStepDetail() can see the true step
  // count, including groups that already cleared.
  const [allRequirementRows, approvalRules] = requisitionIds.length
    ? await withTenant(tenant.id, async (tx) => [
        await tx.select().from(requirementsTable).where(inArray(requirementsTable.requisitionId, requisitionIds)),
        await tx.select().from(approvalRulesTable),
      ])
    : [[], []];
  const stepDetailFor = (requisitionId: string) => approvalStepDetail(allRequirementRows.filter((r) => r.requisitionId === requisitionId));
  const matchedRuleNames = (requisitionId: string) => {
    const ruleIds = [...new Set(allRequirementRows.filter((r) => r.requisitionId === requisitionId && r.sourceRuleId).map((r) => r.sourceRuleId!))];
    return ruleIds.map((id) => approvalRules.find((rule) => rule.id === id)?.name).filter((name): name is string => !!name);
  };

  const catalogItemIds = [...new Set(lines.map((l) => l.catalogItemId).filter((id): id is string => id !== null))];
  const itemHistoryById = new Map<string, ItemPurchaseHistoryEntry[]>();
  if (catalogItemIds.length > 0) {
    await withTenant(tenant.id, async (tx) => {
      for (const itemId of catalogItemIds) {
        itemHistoryById.set(itemId, await getItemPurchaseHistory(tx, itemId, 3));
      }
    });
  }

  const itemName = (id: string | null) => catalogItems.find((i) => i.id === id)?.name ?? null;

  const documentUrls = new Map(
    await Promise.all(
      myActionable
        .map((req) => requisitionById.get(req.requisitionId)!)
        .filter((requisition) => requisition.sourceDocumentKey)
        .map(async (requisition) => [requisition.id, await getRequisitionDocumentUrl(requisition.sourceDocumentKey!)] as const),
    ),
  );

  return (
    <div className="flex flex-col gap-8 p-8">
      <div className="flex flex-col gap-2">
        <Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Approvals" }]} />
        <div>
          <h1 className="font-serif text-lg text-foreground">Approvals</h1>
          <p className="text-sm text-muted-foreground">{myActionable.length} awaiting your decision</p>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        {myActionable.map((req) => {
          const requisition = requisitionById.get(req.requisitionId)!;
          const linesForReq = lines.filter((l) => l.requisitionId === req.requisitionId);
          const costCenter = costCenters.find((c) => c.id === requisition.costCenterId);
          const budget = costCenter?.annualBudget ? Number(costCenter.annualBudget) : null;
          const committed = requisition.costCenterId ? (committedByCostCenter[requisition.costCenterId] ?? 0) : 0;

          return (
            <div key={req.id} className="flex flex-col gap-3 rounded-md border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    {userName(requisition.requestorId)} — {requisition.totalEstimatedValue} {requisition.currency}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {departmentName(requisition.departmentId)} · {costCenterName(requisition.costCenterId)}
                    {req.source === "ad_hoc" && " · ad-hoc addition"}
                    {pendingDays(requisition.submittedAt) !== null && (
                      <> · pending {pendingDays(requisition.submittedAt)} day{pendingDays(requisition.submittedAt) === 1 ? "" : "s"}</>
                    )}
                  </p>
                  {requisition.justification && (
                    <p className="mt-1 text-xs text-muted-foreground">&quot;{requisition.justification}&quot;</p>
                  )}
                  {matchedRuleNames(req.requisitionId).length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Via {matchedRuleNames(req.requisitionId).map((n) => `"${n}"`).join(", ")}
                    </p>
                  )}
                  {documentUrls.has(requisition.id) && (
                    <a
                      href={documentUrls.get(requisition.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-block text-xs text-muted-foreground underline"
                    >
                      View source document
                    </a>
                  )}
                </div>
                <LifecycleStatus stage="Pending approval" detail={stepDetailFor(req.requisitionId)} className="shrink-0 items-end text-right" />
              </div>

              {budget !== null && (
                <p className="text-xs text-muted-foreground">
                  Cost center budget: {budget.toFixed(2)} — already committed: {committed.toFixed(2)} — remaining after
                  this: <span className={budget - committed < 0 ? "text-amber-600" : undefined}>{(budget - committed).toFixed(2)}</span>
                </p>
              )}

              {linesForReq.length > 0 && (
                <div className="flex flex-col gap-1 rounded-md bg-muted/40 p-2 text-xs">
                  {linesForReq.map((line) => {
                    const history = line.catalogItemId ? itemHistoryById.get(line.catalogItemId) : undefined;
                    return (
                      <div key={line.id}>
                        <span className="font-medium">
                          {line.freeTextDescription ?? itemName(line.catalogItemId) ?? "Item"} — {line.quantity} {line.uom} @{" "}
                          {line.estimatedUnitPrice}
                        </span>
                        {history && history.length > 0 ? (
                          <span className="text-muted-foreground">
                            {" "}
                            — previously: {history.map((h) => `${h.unitPrice} (${h.vendorName})`).join(", ")}
                          </span>
                        ) : line.catalogItemId ? (
                          <span className="text-muted-foreground"> — never purchased before</span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex flex-wrap items-end gap-2">
                <form action={approveRequirement} className="flex items-end gap-2">
                  <input type="hidden" name="requirementId" value={req.id} />
                  <input
                    name="comment"
                    placeholder="Comment (optional)"
                    className="h-8 w-48 rounded-md border px-2 text-sm"
                  />
                  <button type="submit" className={cn(buttonVariants())}>Approve</button>
                </form>
                <form action={requestRevision} className="flex items-end gap-2">
                  <input type="hidden" name="requirementId" value={req.id} />
                  <input
                    name="comment"
                    required
                    placeholder="What needs fixing?"
                    className="h-8 w-48 rounded-md border px-2 text-sm"
                  />
                  <button type="submit" className={cn(buttonVariants({ variant: "outline" }))}>Request revision</button>
                </form>
                <form action={rejectAndClose} className="flex items-end gap-2">
                  <input type="hidden" name="requirementId" value={req.id} />
                  <input
                    name="comment"
                    required
                    placeholder="Reason for closing"
                    className="h-8 w-48 rounded-md border px-2 text-sm"
                  />
                  <button type="submit" className={cn(buttonVariants({ variant: "outline" }))}>Reject &amp; close</button>
                </form>
              </div>

              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">Add an approver ad hoc</summary>
                <form action={addAdHocApprover} className="mt-2 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="requisitionId" value={req.requisitionId} />
                  <select name="assignedUserId" required className="h-8 rounded-md border px-2 text-sm">
                    {users
                      .filter((u) => u.id !== requisition.requestorId)
                      .map((u) => (
                        <option key={u.id} value={u.id}>{u.fullName}</option>
                      ))}
                  </select>
                  <input
                    name="reason"
                    required
                    placeholder="Why are they needed?"
                    className="h-8 w-56 rounded-md border px-2 text-sm"
                  />
                  <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                    Add
                  </button>
                </form>
              </details>
            </div>
          );
        })}
      </div>
    </div>
  );
}
