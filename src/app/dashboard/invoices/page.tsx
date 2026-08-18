import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { findInvoiceIdsMatching, INVOICE_SEARCH_FIELDS } from "@/db/pipelineSearch";
import {
  invoices as invoicesTable,
  vendors as vendorsTable,
  paymentInstructions as paymentInstructionsTable,
  purchaseOrders as purchaseOrdersTable,
  purchaseRequisitionLines as purchaseRequisitionLinesTable,
  catalogItems as catalogItemsTable,
  invoiceStatus,
} from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { EmptyState } from "@/components/ui/empty-state";
import { ListControls, ListFilter } from "@/components/ui/list-controls";
import { Info, PageHelp, Term } from "@/components/ui/help";
import { cn } from "@/lib/utils";
import { invoiceStage } from "@/lib/lifecycle";
import { requisitionLabel } from "@/lib/requisitionSummary";
import { LifecycleStatus } from "@/components/ui/lifecycle-status";

type StatusValue = (typeof invoiceStatus.enumValues)[number];

function humanize(status: string): string {
  return status.replace(/_/g, " ");
}

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const params = await searchParams;
  const { tenant } = await getCurrentUserAndTenant();

  const q = typeof params.q === "string" ? params.q.trim() : "";
  const statusFilter = invoiceStatus.enumValues.includes(params.status as StatusValue)
    ? (params.status as StatusValue)
    : null;

  const matchingIds = q ? await withTenant(tenant.id, (tx) => findInvoiceIdsMatching(tx, q)) : null;
  const searchedAndFoundNothing = matchingIds !== null && matchingIds.length === 0;

  const [vendors, openPos] = await withTenant(tenant.id, async (tx) => [
    await tx.select().from(vendorsTable),
    await tx.select().from(purchaseOrdersTable).where(inArray(purchaseOrdersTable.status, ["issued", "partially_fulfilled"])),
  ]);

  const invoiceRows = searchedAndFoundNothing
    ? []
    : await withTenant(tenant.id, (tx) =>
        tx
          .select()
          .from(invoicesTable)
          .where(
            and(
              ...(statusFilter ? [eq(invoicesTable.status, statusFilter)] : []),
              ...(matchingIds ? [inArray(invoicesTable.id, matchingIds)] : []),
            ),
          )
          .orderBy(desc(invoicesTable.createdAt)),
      );

  const invoiceIdsAwaitingPayment = invoiceRows.filter((i) => i.status === "approved_for_payment").map((i) => i.id);
  const paymentRows = invoiceIdsAwaitingPayment.length
    ? await withTenant(tenant.id, (tx) => tx.select().from(paymentInstructionsTable).where(inArray(paymentInstructionsTable.invoiceId, invoiceIdsAwaitingPayment)))
    : [];
  const paymentFor = (invoiceId: string) => paymentRows.find((p) => p.invoiceId === invoiceId);

  // What each invoice is billing for — and what explains why a search for
  // an item name returned a row showing only a number and a vendor.
  const poIds = [...new Set(invoiceRows.map((i) => i.poId).filter((id): id is string => id !== null))];
  const posForInvoices = poIds.length
    ? await withTenant(tenant.id, (tx) => tx.select().from(purchaseOrdersTable).where(inArray(purchaseOrdersTable.id, poIds)))
    : [];
  const requisitionIds = [...new Set(posForInvoices.map((p) => p.requisitionId))];
  const [lines, catalogItems] = requisitionIds.length
    ? await withTenant(tenant.id, async (tx) => [
        await tx.select().from(purchaseRequisitionLinesTable).where(inArray(purchaseRequisitionLinesTable.requisitionId, requisitionIds)),
        await tx.select().from(catalogItemsTable),
      ])
    : [[], []];

  const vendorName = (id: string) => vendors.find((v) => v.id === id)?.name ?? "—";
  const labelFor = (invoice: { poId: string | null }) => {
    const requisitionId = posForInvoices.find((p) => p.id === invoice.poId)?.requisitionId;
    if (!requisitionId) return "—";
    return requisitionLabel(lines.filter((l) => l.requisitionId === requisitionId), catalogItems, { prefer: q });
  };
  const exceptionCount = invoiceRows.filter((i) => i.status === "exception").length;

  const queryWith = (overrides: Record<string, string | null>) => {
    const base: Record<string, string> = { ...(q ? { q } : {}), ...(statusFilter ? { status: statusFilter } : {}) };
    for (const [key, value] of Object.entries(overrides)) {
      if (value === null) delete base[key];
      else base[key] = value;
    }
    const query = new URLSearchParams(base).toString();
    return query ? `?${query}` : "/dashboard/invoices";
  };

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex flex-col gap-2">
        <Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Invoices" }]} />
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="font-serif text-lg text-foreground">Invoices</h1>
            <p className="text-sm text-muted-foreground">
              Capture what vendors bill you, and check it against what was ordered and received before any money
              moves.
              {exceptionCount > 0 && (
                <span className="text-amber-600">
                  {" "}
                  {exceptionCount} {exceptionCount === 1 ? "invoice needs" : "invoices need"} review.
                </span>
              )}
            </p>
          </div>
          <Link href="/dashboard/invoices/new" className={cn(buttonVariants(), "shrink-0")}>
            Capture invoice
          </Link>
        </div>
      </div>

      <PageHelp
        id="invoices"
        title="How invoice checking works"
        steps={{
          capture: "Capture the vendor's invoice against the purchase order it bills for.",
          match: (
            <>
              AWA runs a <Term name="three-way-match" sentenceCase />: the purchase order, the goods receipt or
              service acceptance, and the invoice must agree on quantity and value.
            </>
          ),
          decide: (
            <>
              If they agree it can be approved for payment. If they don&apos;t, it becomes an{" "}
              <Term name="invoice-exception">exception</Term> and somebody has to decide before it can be paid.
            </>
          ),
        }}
      />

      <ListControls
        q={q}
        searchPlaceholder="Invoice number, vendor, what it was for…"
        searchMatches={INVOICE_SEARCH_FIELDS}
        clearHref={q || statusFilter ? "/dashboard/invoices" : undefined}
        count={invoiceRows.length}
      >
        <ListFilter
          name="status"
          label="Status"
          value={statusFilter ?? ""}
          options={[
            { value: "", label: "All statuses" },
            ...invoiceStatus.enumValues.map((s) => ({ value: s, label: humanize(s) })),
          ]}
        />
      </ListControls>

      {invoiceRows.length === 0 ? (
        <EmptyState
          title={q ? `Nothing matches “${q}”` : statusFilter ? "No invoices with that status" : "No invoices captured yet"}
        >
          {q ? (
            <>
              Search covers {INVOICE_SEARCH_FIELDS}.
              {statusFilter && <> The status filter is still set to “{humanize(statusFilter)}”.</>}
              <div className="mt-3">
                <Link href={queryWith({ q: null })} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                  Clear the search
                </Link>
              </div>
            </>
          ) : statusFilter ? (
            <>No invoice is at that stage right now.</>
          ) : (
            <>
              Invoices are entered here against the purchase order they bill for, so AWA can check them before
              anything is paid.{" "}
              {openPos.length > 0
                ? `${openPos.length} purchase ${openPos.length === 1 ? "order is" : "orders are"} open — a vendor invoice usually follows delivery.`
                : "No purchase orders are open yet, so no vendor has anything to bill for."}
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <Link href="/dashboard/invoices/new" className={cn(buttonVariants({ size: "sm" }))}>
                  Capture an invoice
                </Link>
                {openPos.length > 0 && (
                  <Link href="/dashboard/fulfillment" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                    See open purchase orders
                  </Link>
                )}
              </div>
            </>
          )}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-3xl text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-4 font-normal">Invoice #</th>
                <th className="py-2 pr-4 font-normal">For</th>
                <th className="py-2 pr-4 font-normal">Vendor</th>
                <th className="py-2 pr-4 font-normal">Date</th>
                <th className="py-2 pr-4 font-normal">Total</th>
                <th className="py-2 pr-4 font-normal">
                  Status
                  <Info
                    title="Invoice status"
                    next="An exception can be approved anyway with a reason, or disputed with the vendor."
                  >
                    &ldquo;Matched&rdquo; means the invoice agrees with the order and the receipt.
                    &ldquo;Exception&rdquo; means it doesn&apos;t, and payment is held until somebody decides.
                  </Info>
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {invoiceRows.map((i) => (
                <tr key={i.id} className="border-b">
                  <td className="py-2 pr-4 whitespace-nowrap">{i.invoiceNumber}</td>
                  <td className="py-2 pr-4">{labelFor(i)}</td>
                  <td className="py-2 pr-4">{vendorName(i.vendorId)}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">{i.invoiceDate}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">{i.totalAmount} {i.currency}</td>
                  <td className="py-2 pr-4">
                    <LifecycleStatus stage={invoiceStage(i, paymentFor(i.id))} />
                  </td>
                  <td className="py-2">
                    <Link href={`/dashboard/invoices/${i.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
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
