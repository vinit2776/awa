import Link from "next/link";
import { and, eq, inArray } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { findPurchaseOrderIdsMatching, FULFILLMENT_SEARCH_FIELDS } from "@/db/pipelineSearch";
import {
  purchaseOrders as purchaseOrdersTable,
  purchaseRequisitionLines as purchaseRequisitionLinesTable,
  catalogItems as catalogItemsTable,
  vendors as vendorsTable,
  purchaseRequisitions as purchaseRequisitionsTable,
} from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { EmptyState } from "@/components/ui/empty-state";
import { ListControls, ListFilter } from "@/components/ui/list-controls";
import { Info, PageHelp, Term } from "@/components/ui/help";
import { cn } from "@/lib/utils";
import { poStage } from "@/lib/lifecycle";
import { requisitionLabel } from "@/lib/requisitionSummary";
import { LifecycleStatus } from "@/components/ui/lifecycle-status";

type StatusValue = "issued" | "partially_fulfilled";

export default async function FulfillmentPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const params = await searchParams;
  const { tenant } = await getCurrentUserAndTenant();

  const q = typeof params.q === "string" ? params.q.trim() : "";
  const statusFilter: StatusValue | null =
    params.status === "issued" || params.status === "partially_fulfilled" ? params.status : null;

  const matchingIds = q ? await withTenant(tenant.id, (tx) => findPurchaseOrderIdsMatching(tx, q)) : null;
  const searchedAndFoundNothing = matchingIds !== null && matchingIds.length === 0;

  const [vendors, beingSourced] = await withTenant(tenant.id, async (tx) => [
    await tx.select().from(vendorsTable),
    await tx.select().from(purchaseRequisitionsTable).where(eq(purchaseRequisitionsTable.status, "approved")),
  ]);

  const purchaseOrders = searchedAndFoundNothing
    ? []
    : await withTenant(tenant.id, (tx) =>
        tx
          .select()
          .from(purchaseOrdersTable)
          .where(
            and(
              inArray(purchaseOrdersTable.status, statusFilter ? [statusFilter] : ["issued", "partially_fulfilled"]),
              ...(matchingIds ? [inArray(purchaseOrdersTable.id, matchingIds)] : []),
            ),
          ),
      );

  // What each PO is for. The row otherwise says who you're buying from and
  // how much, but not what turned up — and it's what explains why a search
  // for "helmet" returned this row at all.
  const requisitionIds = [...new Set(purchaseOrders.map((po) => po.requisitionId))];
  const [lines, catalogItems] = requisitionIds.length
    ? await withTenant(tenant.id, async (tx) => [
        await tx.select().from(purchaseRequisitionLinesTable).where(inArray(purchaseRequisitionLinesTable.requisitionId, requisitionIds)),
        await tx.select().from(catalogItemsTable),
      ])
    : [[], []];

  const vendorName = (id: string) => vendors.find((v) => v.id === id)?.name ?? "—";
  const labelFor = (po: { requisitionId: string }) =>
    requisitionLabel(lines.filter((l) => l.requisitionId === po.requisitionId), catalogItems, { prefer: q });

  const queryWith = (overrides: Record<string, string | null>) => {
    const base: Record<string, string> = { ...(q ? { q } : {}), ...(statusFilter ? { status: statusFilter } : {}) };
    for (const [key, value] of Object.entries(overrides)) {
      if (value === null) delete base[key];
      else base[key] = value;
    }
    const query = new URLSearchParams(base).toString();
    return query ? `?${query}` : "/dashboard/fulfillment";
  };

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex flex-col gap-2">
        <Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Fulfillment" }]} />
        <div>
          <h1 className="font-serif text-lg text-foreground">Fulfillment</h1>
          <p className="text-sm text-muted-foreground">
            Record what actually arrived. Purchase orders land here once issued and stay until every line is
            received or accepted — then the vendor can invoice against them.
          </p>
        </div>
      </div>

      <PageHelp
        id="fulfillment"
        title="How receiving works"
        steps={{
          record: (
            <>
              Open the purchase order the delivery is against and record a <Term name="goods-receipt" sentenceCase /> —
              or, for work rather than goods, a <Term name="service-acceptance" sentenceCase />.
            </>
          ),
          partial: "A short delivery is fine. Record what turned up; the line stays open for the balance.",
          sod: (
            <>
              The person who raised the requisition cannot be the person who receives it (
              <Term name="segregation-of-duties">segregation of duties</Term>), so this may need a colleague.
            </>
          ),
        }}
      />

      <ListControls
        q={q}
        searchPlaceholder="Helmets, Kalyani, PO-2026-0004…"
        searchMatches={FULFILLMENT_SEARCH_FIELDS}
        clearHref={q || statusFilter ? "/dashboard/fulfillment" : undefined}
        count={purchaseOrders.length}
      >
        <ListFilter
          name="status"
          label="Delivery"
          value={statusFilter ?? ""}
          options={[
            { value: "", label: "All open" },
            { value: "issued", label: "Nothing received yet" },
            { value: "partially_fulfilled", label: "Part-delivered" },
          ]}
        />
      </ListControls>

      {purchaseOrders.length === 0 ? (
        <EmptyState
          title={
            q
              ? `Nothing matches “${q}”`
              : statusFilter
                ? "No purchase orders at that stage"
                : "No deliveries outstanding"
          }
        >
          {q ? (
            <>
              Search covers {FULFILLMENT_SEARCH_FIELDS}.
              {statusFilter && <> The delivery filter is still set, too.</>}
              <div className="mt-3">
                <Link href={queryWith({ q: null })} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                  Clear the search
                </Link>
              </div>
            </>
          ) : (
            <>
              Purchase orders arrive here the moment they are issued to a vendor, and leave once every line has
              been received or accepted.{" "}
              {beingSourced.length > 0 ? (
                <>
                  {beingSourced.length} approved {beingSourced.length === 1 ? "requisition is" : "requisitions are"}{" "}
                  still being sourced.
                  <div className="mt-3">
                    <Link href="/dashboard/sourcing" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                      Go to sourcing
                    </Link>
                  </div>
                </>
              ) : (
                <>Nothing is being sourced either, so no purchase orders are on the way.</>
              )}
            </>
          )}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-2xl text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-4 font-normal">PO</th>
                <th className="py-2 pr-4 font-normal">For</th>
                <th className="py-2 pr-4 font-normal">Vendor</th>
                <th className="py-2 pr-4 font-normal">Total</th>
                <th className="py-2 pr-4 font-normal">
                  Status
                  <Info
                    title="Delivery status"
                    next="Open one to record what arrived — a short delivery keeps the line open for the balance."
                  >
                    &ldquo;Awaiting fulfillment&rdquo; means nothing has been received yet. &ldquo;Partially
                    fulfilled&rdquo; means some quantity arrived and the rest is still owed.
                  </Info>
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {purchaseOrders.map((po) => (
                <tr key={po.id} className="border-b">
                  <td className="py-2 pr-4 whitespace-nowrap">{po.poNumber}</td>
                  <td className="py-2 pr-4">{labelFor(po)}</td>
                  <td className="py-2 pr-4">{vendorName(po.vendorId)}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">{po.totalAmount} {po.currency}</td>
                  <td className="py-2 pr-4"><LifecycleStatus stage={poStage(po)} /></td>
                  <td className="py-2">
                    <Link href={`/dashboard/fulfillment/${po.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                      Open
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
