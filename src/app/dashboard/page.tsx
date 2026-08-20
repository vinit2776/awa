import Link from "next/link";
import { eq, inArray } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { isTenantAdmin } from "@/db/permissions";
import { listMyQueries } from "@/db/clarifications";
import { isBlocked } from "@/db/clarificationRules";
import {
  roles as rolesTable,
  userRoles as userRolesTable,
  purchaseRequisitions as purchaseRequisitionsTable,
  purchaseRequisitionLines as purchaseRequisitionLinesTable,
  catalogItems as catalogItemsTable,
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
import { Card } from "@/components/ui/card";
import { Info, PageHelp } from "@/components/ui/help";
import { LifecycleStatus } from "@/components/ui/lifecycle-status";
import { LifecycleRail } from "@/components/ui/lifecycle-rail";
import { computeStage, approvalStepDetail, railPosition, LIFECYCLE_STEPS, type LifecycleStepKey } from "@/lib/lifecycle";
import { entityLabel } from "@/lib/entityLinks";
import { requisitionLabel } from "@/lib/requisitionSummary";
import { stagesForRoles, STAGE_OWNER_HINT } from "@/lib/roleStages";
import { hasFlag, AWA_REDESIGN_FLAG } from "@/lib/featureFlags";
import { WelcomeCard } from "./WelcomeCard";
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
  const redesigned = hasFlag(tenant.featureFlags, AWA_REDESIGN_FLAG);
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
    const allRfqs = await tx.select().from(rfqsTable);
    const invoices = await tx.select().from(invoicesTable);
    const payments = await tx.select().from(paymentInstructionsTable);
    const purchaseOrders = await tx.select().from(purchaseOrdersTable);

    // Only what's needed to stage my own requisitions — not the tenant's.
    const myIds = myRequisitions.map((r) => r.id);
    const myRequirementRows = myIds.length
      ? await tx.select().from(requirementsTable).where(inArray(requirementsTable.requisitionId, myIds))
      : [];
    // Lines are what a requisition is called — it has no number and no
    // title, so without these every row here reads "600.00 INR".
    const myLines = myIds.length
      ? await tx.select().from(purchaseRequisitionLinesTable).where(inArray(purchaseRequisitionLinesTable.requisitionId, myIds))
      : [];

    return {
      myRequisitions,
      myRequirementRows,
      myLines,
      catalogItems: await tx.select().from(catalogItemsTable),
      pendingRequirements,
      requisitionsInApproval,
      allRequisitions,
      allRfqs,
      invoices,
      payments,
      purchaseOrders,
      users: await tx.select().from(usersTable),
      // The viewer's own roles, for the first-run welcome — which parts of
      // the process are theirs is the one thing worth saying on day one.
      myRoles: await tx
        .select({ key: rolesTable.key, displayName: rolesTable.displayName })
        .from(userRolesTable)
        .innerJoin(rolesTable, eq(rolesTable.id, userRolesTable.roleId))
        .where(eq(userRolesTable.userId, user.id)),
      activeRules: (await tx.select().from(approvalRulesTable)).filter((r) => r.active),
      viewerIsAdmin: await isTenantAdmin(tx, tenant.id, user.id),
    };
  });

  const {
    myRequisitions, myRequirementRows, myLines, catalogItems, pendingRequirements, requisitionsInApproval,
    allRequisitions, allRfqs, invoices, payments, purchaseOrders, users, myRoles, activeRules, viewerIsAdmin,
  } = data;

  const userName = (id: string | null) => users.find((u) => u.id === id)?.fullName ?? "—";
  // A requisition has no number and no title, so what it is *for* is the
  // only label anyone can search their memory for.
  const labelFor = (r: { id: string }) =>
    requisitionLabel(myLines.filter((l) => l.requisitionId === r.id), catalogItems);

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
      const stage = computeStage(r, allRfqs.filter((x) => x.requisitionId === r.id), po, invoice, payment);

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

  if (!redesigned) {
    return (
      <LegacyHome
        tenant={tenant}
        user={user}
        needsMe={needsMe}
        myRoles={myRoles}
        stagesForRoles={stagesForRoles}
        viewerIsAdmin={viewerIsAdmin}
        activeRules={activeRules}
        actionableApprovals={actionableApprovals}
        requisitionsInApproval={requisitionsInApproval}
        userName={userName}
        myRejected={myRejected}
        labelFor={labelFor}
        openQueries={openQueries}
        myDrafts={myDrafts}
        myInFlight={myInFlight}
        queues={queues}
      />
    );
  }

  // ---- Redesign: the seven-stage bar --------------------------------------

  const ownedStages = new Set(stagesForRoles(myRoles.map((r) => r.key)));

  // "Currently sitting at this station" — everything except records that
  // have fully exited the pipeline (Paid) or hit a dead end (cancelled /
  // closed), which aren't waiting on anyone at that stage anymore.
  const DEAD_STAGES = new Set(["Cancelled", "Rejected — closed", "PO cancelled"]);
  const stageCounts = LIFECYCLE_STEPS.map(() => 0);
  for (const r of allRequisitions) {
    const po = purchaseOrders.find((p) => p.requisitionId === r.id);
    const invoice = po ? invoices.find((i) => i.poId === po.id) : undefined;
    const payment = invoice ? payments.find((p) => p.invoiceId === invoice.id) : undefined;
    const stage = computeStage(r, allRfqs.filter((x) => x.requisitionId === r.id), po, invoice, payment);
    if (stage === "Paid" || DEAD_STAGES.has(stage)) continue;
    stageCounts[railPosition(stage).step] += 1;
  }

  const STAGE_TITLE: Record<LifecycleStepKey, string> = {
    requisition: "Someone asks",
    approval: "Someone agrees",
    sourcing: "A vendor is chosen",
    purchase_order: "The order goes out",
    receipt: "It arrives",
    invoice: "The bill is checked",
    payment: "It gets paid",
  };
  const STAGE_HREF: Record<LifecycleStepKey, string> = {
    requisition: "/dashboard/requisitions?scope=all",
    approval: "/dashboard/approvals",
    sourcing: "/dashboard/sourcing",
    purchase_order: "/dashboard/fulfillment",
    receipt: "/dashboard/fulfillment",
    invoice: "/dashboard/invoices",
    payment: "/dashboard/payments",
  };
  const STAGE_SUB: Record<LifecycleStepKey, string | null> = {
    requisition: myDrafts.length > 0 ? `yours · ${myDrafts.length} unsent` : null,
    approval: actionableApprovals.length > 0 ? `${actionableApprovals.length} waiting on you` : null,
    sourcing: null,
    purchase_order: null,
    receipt: null,
    invoice: null,
    payment: null,
  };

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-8">
      <div>
        <h1 className="font-serif text-2xl text-foreground">How buying works here, and where you sit in it</h1>
        <p className="text-sm text-muted-foreground">
          {ownedStages.size} of {LIFECYCLE_STEPS.length} stages are yours — marked below. Numbers are what {tenant.name} is
          holding right now.
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

      <div className="flex overflow-x-auto rounded-xl border border-border">
        {LIFECYCLE_STEPS.map((step, index) => {
          const mine = ownedStages.has(step.key);
          // The owner hint ("procurement", "finance") is written for a
          // stage that isn't the viewer's — showing it on a tinted "mine"
          // column contradicts the tint. An owned stage with nothing more
          // specific to say falls back to "yours", never the hint.
          const sub = STAGE_SUB[step.key] ?? (mine ? "yours" : STAGE_OWNER_HINT[step.key]);
          return (
            <Link
              key={step.key}
              href={STAGE_HREF[step.key]}
              className={cn(
                "min-w-[130px] flex-1 shrink-0 px-3.5 py-4 text-left transition-colors hover:bg-primary/10",
                index < LIFECYCLE_STEPS.length - 1 && "border-r border-border",
                mine && "bg-primary/[0.07]",
              )}
            >
              {mine ? (
                <span className="flex items-center gap-1.5">
                  <span className="size-[7px] shrink-0 rounded-full bg-primary" aria-hidden="true" />
                  <span className="text-[13px] font-medium text-foreground">{STAGE_TITLE[step.key]}</span>
                </span>
              ) : (
                <span className="text-[13px] text-muted-foreground">{STAGE_TITLE[step.key]}</span>
              )}
              <p className="mt-1.5 text-[11.5px] text-muted-foreground/80">{step.label}</p>
              <p className={cn("mt-2.5 text-xl font-medium tabular-nums", mine ? "text-foreground" : "text-muted-foreground")}>
                {stageCounts[index]}
              </p>
              <p className={cn("mt-0.5 text-[11.5px]", mine ? "font-medium text-primary" : "text-muted-foreground")}>
                {sub}
              </p>
            </Link>
          );
        })}
      </div>

      <div className="flex flex-col items-start gap-6 md:flex-row">
        <section className="flex w-full flex-[1.15] flex-col gap-2.5">
          <h2 className="text-[12.5px] font-medium tracking-[0.07em] text-muted-foreground uppercase">
            Waiting on you{actionableApprovals.length + myRejected.length + openQueries.length + myDrafts.length > 0 ? "" : " — nothing right now"}
          </h2>

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
                  title={`"${labelFor(r)}" was sent back`}
                  detail={`An approver asked for changes to your ${r.totalEstimatedValue} ${r.currency} requisition. Revising it restarts approval from the first step.`}
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
                  title={`Unsubmitted draft — ${labelFor(r)}`}
                  detail={`${r.totalEstimatedValue} ${r.currency}. Nobody can see this until you submit it.`}
                  cta={{ label: "Open", href: `/dashboard/requisitions/${r.id}` }}
                />
              ))}
            </ul>
          )}
        </section>

        <section className="flex w-full flex-1 flex-col gap-2.5">
          <h2 className="text-[12.5px] font-medium tracking-[0.07em] text-muted-foreground uppercase">Yours, on the map</h2>
          {myInFlight.length === 0 ? (
            <p className="rounded-lg border border-dashed border-input p-6 text-center text-sm text-muted-foreground">
              Nothing of yours is in flight right now.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {myInFlight.map(({ requisition, stage }) => (
                <Card key={requisition.id} className="p-3">
                  <p className="text-[13.5px] font-medium">{labelFor(requisition)}</p>
                  <LifecycleRail
                    stage={stage}
                    compact
                    href={`/dashboard/requisitions/${requisition.id}`}
                    className="mt-2"
                  />
                  <p className="mt-1.5 text-xs text-muted-foreground">{stage}</p>
                </Card>
              ))}
              <Card className="bg-muted/60">
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  Every request, order, bill and payment in AWA shows this same seven-part bar. Learn it once.
                </p>
              </Card>
            </div>
          )}
        </section>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Link
          href="/dashboard/requisitions/new"
          className="flex flex-1 flex-col gap-1 rounded-[10px] border border-border bg-background px-4.5 py-4 text-left transition-colors hover:bg-muted"
        >
          <span className="text-[15px] font-medium text-foreground">Ask for something</span>
          <span className="text-[13px] text-muted-foreground">
            Two minutes. We&apos;ll tell you who has to agree before you send it.
          </span>
        </Link>
        <Link
          href="/dashboard/requisitions?scope=all"
          className="flex flex-1 flex-col gap-1 rounded-[10px] border border-border bg-background px-4.5 py-4 text-left transition-colors hover:bg-muted"
        >
          <span className="text-[15px] font-medium text-foreground">Find out what happened to something</span>
          <span className="text-[13px] text-muted-foreground">
            Search anyone&apos;s request — see who is holding it and since when.
          </span>
        </Link>
      </div>
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

/**
 * Pre-redesign layout, kept only for tenants without the awaRedesign
 * feature flag (see src/lib/featureFlags.ts) — delete once every tenant
 * has been switched over.
 */
function LegacyHome({
  tenant,
  user,
  needsMe,
  myRoles,
  stagesForRoles: stagesForRolesFn,
  viewerIsAdmin,
  activeRules,
  actionableApprovals,
  requisitionsInApproval,
  userName,
  myRejected,
  labelFor,
  openQueries,
  myDrafts,
  myInFlight,
  queues,
}: {
  tenant: { name: string };
  user: { fullName: string };
  needsMe: number;
  myRoles: { key: string; displayName: string }[];
  stagesForRoles: (roleKeys: string[]) => LifecycleStepKey[];
  viewerIsAdmin: boolean;
  activeRules: unknown[];
  actionableApprovals: { requisitionId: string }[];
  requisitionsInApproval: { id: string; requestorId: string | null }[];
  userName: (id: string | null) => string;
  myRejected: { id: string; totalEstimatedValue: string; currency: string }[];
  labelFor: (r: { id: string }) => string;
  openQueries: { clarification: { id: string; question: string; blocksProgress: boolean }; counterpartName: string; href: string }[];
  myDrafts: { id: string; totalEstimatedValue: string; currency: string }[];
  myInFlight: {
    requisition: { id: string; totalEstimatedValue: string; currency: string; createdAt: Date };
    stage: string;
    stepDetail: string | null;
    waitingOn: { name: string } | null;
    since: Date | null;
  }[];
  queues: { label: string; count: number; href: string; urgent?: boolean }[];
}) {
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

      <WelcomeCard
        firstName={user.fullName.split(" ")[0]}
        roleNames={myRoles.map((r) => r.displayName)}
        ownedStages={stagesForRolesFn(myRoles.map((r) => r.key))}
      />

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
        // The welcome card above already orients a first-time reader, and
        // two tinted panels stacked read as one repeated thing. This stays
        // one click away rather than competing with it.
        defaultCollapsed
        title="How this page works"
        steps={{
          yours:
            "“Waiting on you” is only ever your own work — a decision you owe, a requisition of yours that needs fixing, or a question somebody asked you.",
          inFlight:
            "“Your requisitions in flight” names whoever is currently holding each one, so you can chase a person rather than a status.",
          shared:
            "“Across your organisation” is shared work, counted. It is nobody's in particular until somebody picks it up.",
        }}
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
                title={`"${labelFor(r)}" was sent back`}
                detail={`An approver asked for changes to your ${r.totalEstimatedValue} ${r.currency} requisition. Revising it restarts approval from the first step.`}
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
                meta={clarification.blocksProgress ? `Blocking the ${entityLabel("requisition").toLowerCase()}` : undefined}
              />
            ))}

            {myDrafts.map((r) => (
              <ActionRow
                key={r.id}
                tone="neutral"
                title={`Unsubmitted draft — ${labelFor(r)}`}
                detail={`${r.totalEstimatedValue} ${r.currency}. Nobody can see this until you submit it.`}
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
                className="flex items-start justify-between gap-4 rounded-lg border border-border p-3.5"
              >
                <div className="min-w-0">
                  <Link href={`/dashboard/requisitions/${requisition.id}`} className="text-sm font-medium hover:underline">
                    {labelFor(requisition)}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    <span className="whitespace-nowrap">
                      {requisition.totalEstimatedValue} {requisition.currency}
                    </span>{" "}
                    ·{" "}
                    <span className="whitespace-nowrap">
                      raised {requisition.createdAt.toISOString().slice(0, 10)}
                    </span>
                  </p>
                </div>
                <LifecycleStatus
                  stage={stage}
                  detail={stage === "Pending approval" ? stepDetail : undefined}
                  waitingOn={waitingOn}
                  since={since}
                  className="max-w-xs shrink-0 items-end text-right"
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
