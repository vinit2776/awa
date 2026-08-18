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
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { cn } from "@/lib/utils";
import { LifecycleStatus } from "@/components/ui/lifecycle-status";
import { approvalStepDetail } from "@/lib/lifecycle";
import { requisitionLabel } from "@/lib/requisitionSummary";
import { EmptyState } from "@/components/ui/empty-state";
import { Info, PageHelp } from "@/components/ui/help";
import { isBlocked } from "@/db/clarificationRules";
import { QueriesPanel } from "../queries/QueriesPanel";
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

  /**
   * Who this goes to after you approve. Approving is the one decision
   * whose consequence isn't visible on screen — everything else stays
   * where it is, but approval hands the requisition on, and to whom
   * depends on which rule matched.
   */
  const nextStepAfterApproval = (requisitionId: string, currentGroup: number) => {
    const later = allRequirementRows.filter((r) => r.requisitionId === requisitionId && r.groupNo > currentGroup);
    if (later.length === 0) return null;
    const nextGroup = Math.min(...later.map((r) => r.groupNo));
    const names = [...new Set(later.filter((r) => r.groupNo === nextGroup).map((r) => userName(r.assignedUserId)))];
    return names.length === 1 ? names[0] : `${names.length} approvers`;
  };

  /**
   * How this price compares with the last time the same catalogue item
   * was bought. The history is already loaded and already shown, but as
   * an undifferentiated list of past prices — the comparison is the
   * reason the feature exists, and nobody does that arithmetic by eye.
   */
  const priceVariance = (line: { catalogItemId: string | null; estimatedUnitPrice: string }) => {
    if (!line.catalogItemId) return null;
    const history = itemHistoryById.get(line.catalogItemId);
    const last = history?.[0];
    if (!last) return null;
    const previous = Number(last.unitPrice);
    const now = Number(line.estimatedUnitPrice);
    if (!previous || !Number.isFinite(previous) || !Number.isFinite(now)) return null;
    const pct = ((now - previous) / previous) * 100;
    if (Math.abs(pct) < 1) return null;
    return { pct, last };
  };

  const documentUrls = new Map(
    await Promise.all(
      myActionable
        .map((req) => requisitionById.get(req.requisitionId)!)
        .filter((requisition) => requisition.sourceDocumentKey)
        .map(async (requisition) => [requisition.id, await getRequisitionDocumentUrl(requisition.sourceDocumentKey!)] as const),
    ),
  );
  // "Held" is derived from an open blocking query existing, never stored on the
  // requisition — which is why a blocking query needs no new requisition_status
  // value and can never leave a record stuck in a stale state.
  const blockedByRequisition = new Map<string, boolean>();
  if (requisitionIds.length > 0) {
    await withTenant(tenant.id, async (tx) => {
      for (const id of requisitionIds) {
        blockedByRequisition.set(id, await isBlocked(tx, "requisition", id));
      }
    });
  }

  return (
    <div className="flex flex-col gap-8 p-8">
      <div className="flex flex-col gap-2">
        <Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Approvals" }]} />
        <div>
          <h1 className="font-serif text-lg text-foreground">Approvals</h1>
          <p className="text-sm text-muted-foreground">
            Requisitions waiting on a decision from you. Nothing here is visible to other approvers until
            you have decided — a multi-step chain opens one step at a time.
          </p>
        </div>
      </div>

      <PageHelp
        id="approvals"
        title="Your four options, and what each one does"
        steps={{
          approve: "Approve hands the requisition on — to the next approver if there is one, or to sourcing if you are the last.",
          ask: "Asking a question holds it exactly where it is. The requester keeps their place in the queue and nothing is rejected.",
          back: "Sending it back lets the requester edit and resubmit. Approval then restarts from the first step, including you.",
        }}
      />

      {myActionable.length === 0 && (
        <EmptyState title="Nothing waiting on you">
          Requisitions appear here when an approval rule routes one to you and every earlier step has
          cleared. If you are expecting something, it may still be with an earlier approver.
        </EmptyState>
      )}

      <div className="flex flex-col gap-6">
        {myActionable.map((req) => {
          const requisition = requisitionById.get(req.requisitionId)!;
          const blocked = blockedByRequisition.get(req.requisitionId) ?? false;
          const linesForReq = lines.filter((l) => l.requisitionId === req.requisitionId);
          const costCenter = costCenters.find((c) => c.id === requisition.costCenterId);
          const budget = costCenter?.annualBudget ? Number(costCenter.annualBudget) : null;
          const committed = requisition.costCenterId ? (committedByCostCenter[requisition.costCenterId] ?? 0) : 0;

          return (
            <div key={req.id} className="flex flex-col gap-3 rounded-md border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    {userName(requisition.requestorId)} needs {requisition.totalEstimatedValue}{" "}
                    {requisition.currency} for {requisitionLabel(linesForReq, catalogItems)}
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
                <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                  <LifecycleStatus stage="Pending approval" detail={stepDetailFor(req.requisitionId)} />
                  {req.escalatedAt && <Badge variant="destructive">Escalated</Badge>}
                </div>
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
                            {(() => {
                              const variance = priceVariance(line);
                              if (!variance) return null;
                              const up = variance.pct > 0;
                              return (
                                <span className={up ? "text-amber-600" : "text-emerald-600"}>
                                  {" "}
                                  — {Math.abs(variance.pct).toFixed(1)}% {up ? "higher" : "lower"} than the last
                                  purchase
                                </span>
                              );
                            })()}
                          </span>
                        ) : line.catalogItemId ? (
                          <span className="text-muted-foreground"> — never purchased before</span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}

              {blocked && (
                <div className="flex items-center gap-3 rounded-lg border border-warning/45 bg-warning/10 px-3.5 py-2.5">
                  <span className="w-[3px] self-stretch rounded-sm bg-warning" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-medium text-warning-foreground">Held — open query on this requisition</p>
                    <p className="text-xs text-muted-foreground">
                      Approve and reject unlock once the person who asked resolves it. The requisition itself is
                      untouched and still pending approval.
                    </p>
                  </div>
                </div>
              )}

              {/* Four choices, ranked and each stating its consequence, rather
                  than three peer forms of equal visual weight. The old layout
                  gave "Reject & close" — which is permanent and forces a brand
                  new requisition — the same prominence as "Approve", and hid
                  the cheap option (ask a question) below the fold entirely. */}
              <fieldset disabled={blocked} className="flex flex-col gap-2 disabled:opacity-50">
                <legend className="sr-only">Your decision</legend>

                <div className="flex items-start gap-3 rounded-lg border border-primary/35 p-3">
                  <span className="mt-0.5 w-[3px] self-stretch rounded-sm bg-primary" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">Approve</p>
                    <p className="text-xs text-muted-foreground">
                      {(() => {
                        const next = nextStepAfterApproval(req.requisitionId, req.groupNo);
                        return next
                          ? `Goes to ${next} for the next step. ${userName(requisition.requestorId)} is notified.`
                          : `You are the last approver — this moves straight to sourcing. ${userName(requisition.requestorId)} is notified.`;
                      })()}
                    </p>
                    <form action={approveRequirement} className="mt-2 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="requirementId" value={req.id} />
                      <input
                        name="comment"
                        placeholder="Comment (optional)"
                        className="h-8 w-48 rounded-md border px-2 text-sm"
                      />
                      <button type="submit" className={cn(buttonVariants())}>Approve</button>
                    </form>
                  </div>
                </div>

                <div className="flex items-start gap-3 rounded-lg border border-border p-3">
                  <span className="mt-0.5 w-[3px] self-stretch rounded-sm bg-warning" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">Send back for changes</p>
                    <p className="text-xs text-muted-foreground">
                      {userName(requisition.requestorId)} edits and resubmits. Approval then restarts from the
                      first step — including you.
                      <Info title="Send back vs reject" next="Use this whenever the answer could become yes.">
                        Sending back keeps the requisition alive: the same record is revised and resubmitted.
                        Rejecting closes it for good.
                      </Info>
                    </p>
                    <form action={requestRevision} className="mt-2 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="requirementId" value={req.id} />
                      <input
                        name="comment"
                        required
                        placeholder="What needs fixing?"
                        className="h-8 w-56 rounded-md border px-2 text-sm"
                      />
                      <button type="submit" className={cn(buttonVariants({ variant: "outline" }))}>
                        Send back
                      </button>
                    </form>
                  </div>
                </div>

                <details className="rounded-lg border border-border p-3">
                  <summary className="cursor-pointer text-sm font-medium text-destructive">
                    Reject and close
                  </summary>
                  <p className="mt-1 text-xs text-muted-foreground">
                    <strong className="text-destructive">Permanent.</strong>{" "}
                    {userName(requisition.requestorId)} would have to raise a brand-new requisition from
                    scratch. Use &ldquo;send back&rdquo; unless the answer is genuinely no.
                  </p>
                  <form action={rejectAndClose} className="mt-2 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="requirementId" value={req.id} />
                    <input
                      name="comment"
                      required
                      placeholder="Reason for closing"
                      className="h-8 w-56 rounded-md border px-2 text-sm"
                    />
                    <button type="submit" className={cn(buttonVariants({ variant: "destructive" }))}>
                      Reject &amp; close
                    </button>
                  </form>
                </details>
              </fieldset>

              {/* The lightweight move that didn't exist before: ask instead of
                  rejecting a requisition over a one-line question. canBlock is
                  true here because this user is a pending approver — the server
                  re-derives that regardless of what the form sends. */}
              <QueriesPanel
                entityType="requisition"
                entityId={req.requisitionId}
                returnTo="/dashboard/approvals"
                canBlock
              />

              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">
                  Bring someone else in on this decision
                  <Info
                    title="Ad-hoc approver"
                    next="It changes this requisition only — not the rule for future ones."
                  >
                    Adds one more person to this requisition&apos;s approval chain. You&apos;ll be asked why,
                    and the reason is recorded in the audit log.
                  </Info>
                </summary>
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
