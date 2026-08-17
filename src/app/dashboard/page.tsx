import Link from "next/link";
import { eq, inArray } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { isTenantAdmin } from "@/db/permissions";
import { listMyQueries } from "@/db/clarifications";
import { isBlocked } from "@/db/clarificationRules";
import {
  purchaseRequisitions as purchaseRequisitionsTable,
  requisitionApprovalRequirements as requirementsTable,
  approvalRules as approvalRulesTable,
  rfqs as rfqsTable,
  purchaseOrders as purchaseOrdersTable,
  invoices as invoicesTable,
  paymentInstructions as paymentInstructionsTable,
  users as usersTable,
} from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Info, PageHelp } from "@/components/ui/help";
import { LifecycleStatus } from "@/components/ui/lifecycle-status";
import { computeStage, approvalStepDetail } from "@/lib/lifecycle";
import { entityLabel } from "@/lib/entityLinks";
import { cn } from "@/lib/utils";

/**
 * The first screen after sign-in, and until now a debug page: it printed
 * every colleague's email and status to demonstrate that RLS scopes the
 * query. That demonstration is real and worth keeping — it lives in
 * db/__tests__/rls-isolation.test.ts, where a failure is a launch
 * blocker rather than a paragraph nobody reads.
 *
 * What replaces it answers the only question a person actually arrives
 * with: is anything waiting on me, and if not, is my stuff moving.
 *
 * Everything below is assembled from the same queries the individual
 * pages already run, inside one transaction — no derived view, no new
 * tables. The volumes are one tenant's open work. If this ever gets slow
 * the fix is a view, but building one now would be guessing.
 */
export default async function DashboardPage() {
  const { user, tenant } = await getCurrentUserAndTenant();
  const { askedOfMe } = await listMyQueries();

  const data = await withTenant(tenant.id, async (tx) => {
    const myRequisitions = await tx
      .select()
      .from(purchaseRequisitionsTable)
      .where(eq(purchaseRequisitionsTable.requestorId, user.id));

    const pendingRequirements = await tx.select().from(requirementsTable).where(eq(requirementsTable.status, "pending"));
    const requisitionsInApproval = await tx
      .select()
      .from(purchaseRequisitionsTable)
      .where(eq(purchaseRequisitionsTable.status, "pending_approval"));

    const allRequisitions = await tx.select().from(purchaseRequisitionsTable);
    const invoices = await tx.select().from(invoicesTable);
    const payments = await tx.select().from(paymentInstructionsTable);
    const purchaseOrders = await tx.select().from(purchaseOrdersTable);

    // Only what's needed to stage my own requisitions — not the tenant's.
    const myIds = myRequisitions.map((r) => r.id);
    const myRfqs = myIds.length
      ? await tx.select().from(rfqsTable).where(inArray(rfqsTable.requisitionId, myIds))
      : [];
    const myRequirementRows = myIds.length
      ? await tx.select().from(requirementsTable).where(inArray(requirementsTable.requisitionId, myIds))
      : [];

    return {
      myRequisitions,
      myRfqs,
      myRequirementRows,
      pendingRequirements,
      requisitionsInApproval,
      allRequisitions,
      invoices,
      payments,
      purchaseOrders,
      users: await tx.select().from(usersTable),
      activeRules: (await tx.select().from(approvalRulesTable)).filter((r) => r.active),
      viewerIsAdmin: await isTenantAdmin(tx, tenant.id, user.id),
    };
  });

  const {
    myRequisitions, myRfqs, myRequirementRows, pendingRequirements, requisitionsInApproval,
    allRequisitions, invoices, payments, purchaseOrders, users, activeRules, viewerIsAdmin,
  } = data;

  const userName = (id: string | null) => users.find((u) => u.id === id)?.fullName ?? "—";

  // ---- Waiting on me -----------------------------------------------------

  // Same rule the approvals inbox applies: only the lowest-numbered
  // pending group is actionable. Later groups have rows but aren't
  // anybody's problem yet.
  const currentGroupFor = new Map<string, number>();
  for (const req of pendingRequirements) {
    const current = currentGroupFor.get(req.requisitionId);
    if (current === undefined || req.groupNo < current) currentGroupFor.set(req.requisitionId, req.groupNo);
  }
  const inApprovalIds = new Set(requisitionsInApproval.map((r) => r.id));
  const myApprovals = pendingRequirements.filter(
    (req) =>
      req.assignedUserId === user.id &&
      inApprovalIds.has(req.requisitionId) &&
      currentGroupFor.get(req.requisitionId) === req.groupNo,
  );

  // An approval held by an open blocking query is waiting on whoever was
  // asked, not on the approver — counting it as "needs you" would be a lie.
  const blocked = new Set<string>();
  if (myApprovals.length > 0) {
    await withTenant(tenant.id, async (tx) => {
      for (const req of myApprovals) {
        if (await isBlocked(tx, "requisition", req.requisitionId)) blocked.add(req.requisitionId);
      }
    });
  }
  const actionableApprovals = myApprovals.filter((req) => !blocked.has(req.requisitionId));

  const myDrafts = myRequisitions.filter((r) => r.status === "draft");
  const myRejected = myRequisitions.filter((r) => r.status === "rejected_revisable");
  const openQueries = askedOfMe.filter((q) => q.clarification.status === "open");

  const needsMe =
    actionableApprovals.length + myDrafts.length + myRejected.length + openQueries.length;

  // ---- My requisitions still in flight ------------------------------------

  const TERMINAL = ["rejected_closed", "cancelled"];
  const myInFlight = myRequisitions
    .filter((r) => !TERMINAL.includes(r.status) && r.status !== "draft" && r.status !== "rejected_revisable")
    .map((r) => {
      const po = purchaseOrders.find((p) => p.requisitionId === r.id);
      const invoice = po ? invoices.find((i) => i.poId === po.id) : undefined;
      const payment = invoice ? payments.find((p) => p.invoiceId === invoice.id) : undefined;
      const stage = computeStage(r, myRfqs.filter((x) => x.requisitionId === r.id), po, invoice, payment);

      const pendingForThis = myRequirementRows.filter((x) => x.requisitionId === r.id && x.status === "pending");
      const currentGroup = pendingForThis.length ? Math.min(...pendingForThis.map((x) => x.groupNo)) : null;
      const currentApprovers = pendingForThis.filter((x) => x.groupNo === currentGroup);
      return {
        requisition: r,
        stage,
        stepDetail: approvalStepDetail(myRequirementRows.filter((x) => x.requisitionId === r.id)),
        waitingOn:
          r.status === "pending_approval" && currentApprovers.length > 0
            ? {
                name:
                  currentApprovers.length === 1
                    ? userName(currentApprovers[0].assignedUserId)
                    : `${currentApprovers.length} approvers`,
              }
            : null,
        since: currentApprovers.length ? (currentApprovers[0].actionableAt ?? r.submittedAt) : null,
      };
    })
    .filter((row) => row.stage !== "Paid")
    .slice(0, 5);

  // ---- Shared queues ------------------------------------------------------

  // Deliberately framed as the organisation's, not "yours". AWA has no
  // role-based UI gating yet (README, launch readiness), so every one of
  // these pages is already visible to everyone — but telling a requestor
  // that a failed payment "needs you" would be inventing a
  // responsibility the app can't actually assign.
  const queues = [
    { label: "Requisitions awaiting sourcing", count: allRequisitions.filter((r) => r.status === "approved").length, href: "/dashboard/sourcing" },
    { label: "Purchase orders awaiting delivery", count: purchaseOrders.filter((p) => p.status === "issued" || p.status === "partially_fulfilled").length, href: "/dashboard/fulfillment" },
    { label: "Invoice exceptions", count: invoices.filter((i) => i.status === "exception").length, href: "/dashboard/invoices", urgent: true },
    { label: "Payments to release", count: payments.filter((p) => p.status === "queued").length, href: "/dashboard/payments" },
    { label: "Failed payments", count: payments.filter((p) => p.status === "failed").length, href: "/dashboard/payments", urgent: true },
  ].filter((q) => q.count > 0);

  return (
    <div className="flex flex-1 flex-col gap-6 p-8">
      <div>
        <h1 className="font-serif text-2xl text-foreground">Today</h1>
        <p className="text-sm text-muted-foreground">
          {needsMe === 0
            ? `Nothing is waiting on you, ${user.fullName.split(" ")[0]}.`
            : `${needsMe} thing${needsMe === 1 ? "" : "s"} need${needsMe === 1 ? "s" : ""} you, ${user.fullName.split(" ")[0]}. Everything else is moving on its own.`}
        </p>
      </div>

      {viewerIsAdmin && activeRules.length === 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3.5 py-3">
          <span className="mt-0.5 w-[3px] self-stretch rounded-sm bg-destructive" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">Nothing is being approved by anyone yet</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {tenant.name} has no active approval rules, so every requisition anyone submits is approved
              automatically the moment it is sent.
              <Info
                title="Why it auto-approves"
                next="One rule — say, anything over 0 needs a department head — closes the gap."
              >
                When no rule matches a requisition there is nobody to route it to, so AWA approves it rather
                than leaving it stuck forever. That keeps a half-configured tenant from deadlocking, but it
                means the controls you bought aren&apos;t running yet.
              </Info>
            </p>
            <Link
              href="/dashboard/admin/approval-rules"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-2")}
            >
              Set up approval rules
            </Link>
          </div>
        </div>
      )}

      <PageHelp
        id="today"
        title="How this page works"
        steps={[
          "“Waiting on you” is only ever your own work — a decision you owe, a requisition of yours that needs fixing, or a question somebody asked you.",
          "“Your requisitions in flight” names whoever is currently holding each one, so you can chase a person rather than a status.",
          "“Across your organisation” is shared work, counted. It is nobody's in particular until somebody picks it up.",
        ]}
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Waiting on you</h2>

        {needsMe === 0 ? (
          <p className="rounded-lg border border-dashed border-input p-6 text-center text-sm text-muted-foreground">
            Nothing needs a decision from you right now.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {actionableApprovals.length > 0 && (
              <ActionRow
                tone="primary"
                title={`Approve ${actionableApprovals.length} requisition${actionableApprovals.length === 1 ? "" : "s"}`}
                detail={
                  actionableApprovals.length === 1
                    ? `${userName(requisitionsInApproval.find((r) => r.id === actionableApprovals[0].requisitionId)?.requestorId ?? null)} is waiting on your decision.`
                    : "Each one is waiting on your decision before it can go any further."
                }
                cta={{ label: "Review", href: "/dashboard/approvals" }}
              />
            )}

            {myRejected.map((r) => (
              <ActionRow
                key={r.id}
                tone="warning"
                title={`Your requisition for ${r.totalEstimatedValue} ${r.currency} was sent back`}
                detail="An approver asked for changes. Revising it restarts approval from the first step."
                cta={{ label: "Revise", href: `/dashboard/requisitions/${r.id}/edit` }}
              />
            ))}

            {openQueries.map(({ clarification, counterpartName, href }) => (
              <ActionRow
                key={clarification.id}
                tone="info"
                title={`${counterpartName} asked you a question`}
                detail={clarification.question}
                cta={{ label: "Answer", href }}
                meta={clarification.blocksProgress ? `Blocking the ${entityLabel(clarification.entityType).toLowerCase()}` : undefined}
              />
            ))}

            {myDrafts.map((r) => (
              <ActionRow
                key={r.id}
                tone="neutral"
                title={`Unsubmitted draft — ${r.totalEstimatedValue} ${r.currency}`}
                detail="Nobody can see this until you submit it."
                cta={{ label: "Open", href: `/dashboard/requisitions/${r.id}` }}
              />
            ))}
          </ul>
        )}
      </section>

      {myInFlight.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground">Your requisitions in flight</h2>
            <Link href="/dashboard/requisitions" className="text-xs text-muted-foreground underline underline-offset-2">
              See all
            </Link>
          </div>
          <ul className="flex flex-col gap-2">
            {myInFlight.map(({ requisition, stage, stepDetail, waitingOn, since }) => (
              <li
                key={requisition.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border p-3.5"
              >
                <div>
                  <Link href={`/dashboard/requisitions/${requisition.id}`} className="text-sm font-medium hover:underline">
                    {requisition.totalEstimatedValue} {requisition.currency}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    Raised {requisition.createdAt.toISOString().slice(0, 10)}
                  </p>
                </div>
                <LifecycleStatus
                  stage={stage}
                  detail={stage === "Pending approval" ? stepDetail : undefined}
                  waitingOn={waitingOn}
                  since={since}
                  className="max-w-sm items-end text-right"
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {queues.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            Across {tenant.name}
            <Info title="Shared work" next="Open any of these to pick something up.">
              Work that belongs to the organisation rather than to one person — whoever holds the relevant
              role picks it up. Counts are live.
            </Info>
          </h2>
          <ul className="flex flex-wrap gap-2">
            {queues.map((q) => (
              <li key={q.label}>
                <Link
                  href={q.href}
                  className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-muted"
                >
                  <span className="font-medium tabular-nums">{q.count}</span>
                  <span className="text-muted-foreground">{q.label}</span>
                  {q.urgent && <Badge variant="warning">needs review</Badge>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ActionRow({
  tone,
  title,
  detail,
  meta,
  cta,
}: {
  tone: "primary" | "warning" | "info" | "neutral";
  title: string;
  detail: string;
  meta?: string;
  cta: { label: string; href: string };
}) {
  const accent = {
    primary: "bg-primary",
    warning: "bg-warning",
    info: "bg-chart-1",
    neutral: "bg-muted-foreground",
  }[tone];

  return (
    <li className="flex items-start gap-3 rounded-lg border border-border p-3.5">
      <span className={cn("mt-0.5 w-[3px] self-stretch rounded-sm", accent)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{detail}</p>
        {meta && <p className="mt-0.5 text-xs text-muted-foreground">{meta}</p>}
      </div>
      <Link href={cta.href} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0")}>
        {cta.label}
      </Link>
    </li>
  );
}
