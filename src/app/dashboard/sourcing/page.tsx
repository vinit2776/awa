import Link from "next/link";
import { and, eq, inArray } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import {
  purchaseRequisitions as purchaseRequisitionsTable,
  purchaseRequisitionLines as purchaseRequisitionLinesTable,
  catalogItems as catalogItemsTable,
  rfqs as rfqsTable,
  users as usersTable,
  departments as departmentsTable,
} from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { EmptyState } from "@/components/ui/empty-state";
import { Info, PageHelp, Term } from "@/components/ui/help";
import { cn } from "@/lib/utils";
import { sourcingStage } from "@/lib/lifecycle";
import { requisitionLabel } from "@/lib/requisitionSummary";
import { findRequisitionIdsMatching } from "@/db/requisitionSearch";
import { SOURCING_SEARCH_FIELDS } from "@/db/pipelineSearch";
import { ListControls, ListFilter } from "@/components/ui/list-controls";
import { LifecycleStatus } from "@/components/ui/lifecycle-status";

export default async function SourcingPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; dept?: string; rfq?: string }>;
}) {
  const params = await searchParams;
  const { tenant } = await getCurrentUserAndTenant();

  const q = typeof params.q === "string" ? params.q.trim() : "";
  const deptFilter = typeof params.dept === "string" && params.dept ? params.dept : null;
  const rfqFilter = params.rfq === "open" || params.rfq === "none" ? params.rfq : null;

  const matchingIds = q ? await withTenant(tenant.id, (tx) => findRequisitionIdsMatching(tx, q)) : null;
  const searchedAndFoundNothing = matchingIds !== null && matchingIds.length === 0;

  const [users, departments, awaitingApproval] = await withTenant(tenant.id, async (tx) => [
    await tx.select().from(usersTable),
    await tx.select().from(departmentsTable),
    // Only used to point somewhere useful when this page is empty, which
    // it is for the first weeks of any deployment.
    await tx.select().from(purchaseRequisitionsTable).where(eq(purchaseRequisitionsTable.status, "pending_approval")),
  ]);

  const requisitions = searchedAndFoundNothing
    ? []
    : await withTenant(tenant.id, (tx) =>
        tx
          .select()
          .from(purchaseRequisitionsTable)
          .where(
            and(
              eq(purchaseRequisitionsTable.status, "approved"),
              ...(deptFilter ? [eq(purchaseRequisitionsTable.departmentId, deptFilter)] : []),
              ...(matchingIds ? [inArray(purchaseRequisitionsTable.id, matchingIds)] : []),
            ),
          ),
      );

  const requisitionIds = requisitions.map((r) => r.id);
  const rfqRows = requisitionIds.length
    ? await withTenant(tenant.id, (tx) => tx.select().from(rfqsTable).where(inArray(rfqsTable.requisitionId, requisitionIds)))
    : [];
  const requisitionIdsWithRfq = new Set(rfqRows.map((rfq) => rfq.requisitionId));

  // "Quoting" vs "not started" is derived from whether an RFQ exists, not
  // stored on the requisition, so it filters here rather than in SQL.
  const visible = rfqFilter
    ? requisitions.filter((r) =>
        rfqFilter === "open" ? requisitionIdsWithRfq.has(r.id) : !requisitionIdsWithRfq.has(r.id),
      )
    : requisitions;

  // What is actually being bought. Sourcing is the one screen where that
  // is the whole job, and it was the one column missing.
  const [lines, catalogItems] = requisitionIds.length
    ? await withTenant(tenant.id, async (tx) => [
        await tx.select().from(purchaseRequisitionLinesTable).where(inArray(purchaseRequisitionLinesTable.requisitionId, requisitionIds)),
        await tx.select().from(catalogItemsTable),
      ])
    : [[], []];

  const requestorName = (id: string) => users.find((u) => u.id === id)?.fullName ?? "—";
  const departmentName = (id: string | null) => departments.find((d) => d.id === id)?.name ?? "—";
  const labelFor = (r: { id: string }) =>
    requisitionLabel(lines.filter((l) => l.requisitionId === r.id), catalogItems, { prefer: q });

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex flex-col gap-2">
        <Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Sourcing" }]} />
        <div>
          <h1 className="font-serif text-lg text-foreground">Sourcing</h1>
          <p className="text-sm text-muted-foreground">
            Turn approved <Term name="requisition">requisitions</Term> into purchase orders — either by inviting
            vendors to quote, or by ordering directly when the vendor and price are already settled.
          </p>
        </div>
      </div>

      <PageHelp
        id="sourcing"
        title="How sourcing works"
        steps={{
          invite: (
            <>
              Open an approved requisition. Raise an <Term name="rfq" /> to invite two or more vendors to quote, or
              skip straight to a purchase order.
            </>
          ),
          compare:
            "Compare the quotations side by side. What each item cost last time, and from whom, is shown against it.",
          issue:
            "Select one to issue the purchase order. It carries a QR code and document hash the vendor can verify.",
        }}
      />

      <ListControls
        q={q}
        searchPlaceholder="Item, requester, department…"
        searchMatches={SOURCING_SEARCH_FIELDS}
        clearHref={q || deptFilter || rfqFilter ? "/dashboard/sourcing" : undefined}
        count={visible.length}
      >
        <ListFilter
          name="rfq"
          label="Progress"
          value={rfqFilter ?? ""}
          options={[
            { value: "", label: "All" },
            { value: "none", label: "Not started" },
            { value: "open", label: "Quoting" },
          ]}
        />
        <ListFilter
          name="dept"
          label="Department"
          value={deptFilter ?? ""}
          options={[
            { value: "", label: "All departments" },
            ...departments.map((d) => ({ value: d.id, label: d.name })),
          ]}
        />
      </ListControls>

      {visible.length === 0 ? (
        <EmptyState
          title={
            q
              ? `Nothing matches “${q}”`
              : deptFilter || rfqFilter
                ? "Nothing matches those filters"
                : "Nothing to source yet"
          }
        >
          {q || deptFilter || rfqFilter ? (
            <>
              Search covers {SOURCING_SEARCH_FIELDS}, across requisitions that have cleared approval — one
              still being approved won&apos;t appear here whatever you search for.
              <div className="mt-3">
                <Link href="/dashboard/sourcing" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                  Clear filters
                </Link>
              </div>
            </>
          ) : (
            <>
          Requisitions arrive here the moment their last approver signs off.{" "}
          {awaitingApproval.length > 0 ? (
            <>
              {awaitingApproval.length} {awaitingApproval.length === 1 ? "is" : "are"} in approval right now.
            </>
          ) : (
            <>Nothing is in approval either — sourcing starts once somebody raises a requisition.</>
          )}
          {awaitingApproval.length > 0 && (
            <div className="mt-3">
              <Link
                href="/dashboard/requisitions?scope=all&status=pending_approval"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              >
                See what&apos;s in approval
              </Link>
            </div>
          )}
            </>
          )}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
        <table className="w-full min-w-2xl text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-4 font-normal">For</th>
              <th className="py-2 pr-4 font-normal">Requestor</th>
              <th className="py-2 pr-4 font-normal">Department</th>
              <th className="py-2 pr-4 font-normal">Total</th>
              <th className="py-2 pr-4 font-normal">
                Status
                <Info title="Sourcing status" next="Open one to invite vendors or issue the purchase order.">
                  &ldquo;Awaiting sourcing&rdquo; means nobody has started. &ldquo;Sourcing&rdquo; means an RFQ is
                  open and quotations may still be arriving.
                </Info>
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id} className="border-b">
                <td className="py-2 pr-4">{labelFor(r)}</td>
                <td className="py-2 pr-4">{requestorName(r.requestorId)}</td>
                <td className="py-2 pr-4">{departmentName(r.departmentId)}</td>
                <td className="py-2 pr-4 whitespace-nowrap">{r.totalEstimatedValue} {r.currency}</td>
                <td className="py-2 pr-4">
                  <LifecycleStatus stage={sourcingStage(requisitionIdsWithRfq.has(r.id))} />
                </td>
                <td className="py-2">
                  <Link href={`/dashboard/sourcing/${r.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                    Source
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
