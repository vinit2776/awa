import Link from "next/link";
import { and, inArray } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import {
  paymentInstructions as paymentInstructionsTable,
  invoices as invoicesTable,
  vendors as vendorsTable,
  purchaseOrders as purchaseOrdersTable,
  purchaseRequisitionLines as purchaseRequisitionLinesTable,
  catalogItems as catalogItemsTable,
} from "@/db/schema";
import { findPaymentIdsMatching, PAYMENT_SEARCH_FIELDS } from "@/db/pipelineSearch";
import { requisitionLabel } from "@/lib/requisitionSummary";
import { ListControls } from "@/components/ui/list-controls";
import { buttonVariants } from "@/components/ui/button";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { EmptyState } from "@/components/ui/empty-state";
import { Info, PageHelp } from "@/components/ui/help";
import { cn } from "@/lib/utils";
import { LifecycleStatus } from "@/components/ui/lifecycle-status";
import { releasePayment, markPaymentFailed, retryPayment } from "./actions";

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const { tenant } = await getCurrentUserAndTenant();
  const q = typeof params.q === "string" ? params.q.trim() : "";

  const matchingIds = q ? await withTenant(tenant.id, (tx) => findPaymentIdsMatching(tx, q)) : null;
  const searchedAndFoundNothing = matchingIds !== null && matchingIds.length === 0;

  const [invoiceRows, vendors] = await withTenant(tenant.id, async (tx) => [
    await tx.select().from(invoicesTable),
    await tx.select().from(vendorsTable),
  ]);

  const paymentRows = searchedAndFoundNothing
    ? []
    : await withTenant(tenant.id, (tx) =>
        tx
          .select()
          .from(paymentInstructionsTable)
          .where(
            and(
              inArray(paymentInstructionsTable.status, ["queued", "failed"]),
              ...(matchingIds ? [inArray(paymentInstructionsTable.id, matchingIds)] : []),
            ),
          ),
      );

  // Only read when the queue is empty, to say where the work is instead.
  const awaitingApproval = invoiceRows.filter((i) => i.status === "matched");

  // What each payment is actually for. The row otherwise shows an invoice
  // number and an amount, which is no help to somebody chasing "the helmet
  // payment" — and it is what explains an inherited search match.
  const shownInvoiceIds = [...new Set(paymentRows.map((p) => p.invoiceId))];
  const poIds = [
    ...new Set(
      invoiceRows.filter((i) => shownInvoiceIds.includes(i.id)).map((i) => i.poId).filter((id): id is string => id !== null),
    ),
  ];
  const [posForPayments, lines, catalogItems] = poIds.length
    ? await withTenant(tenant.id, async (tx) => {
        const pos = await tx.select().from(purchaseOrdersTable).where(inArray(purchaseOrdersTable.id, poIds));
        const requisitionIds = [...new Set(pos.map((po) => po.requisitionId))];
        return [
          pos,
          requisitionIds.length
            ? await tx.select().from(purchaseRequisitionLinesTable).where(inArray(purchaseRequisitionLinesTable.requisitionId, requisitionIds))
            : [],
          await tx.select().from(catalogItemsTable),
        ] as const;
      })
    : [[], [], []];

  const labelForPayment = (invoiceId: string) => {
    const invoice = invoiceRows.find((i) => i.id === invoiceId);
    const requisitionId = posForPayments.find((po) => po.id === invoice?.poId)?.requisitionId;
    if (!requisitionId) return "—";
    return requisitionLabel(lines.filter((l) => l.requisitionId === requisitionId), catalogItems, { prefer: q });
  };

  const queued = paymentRows.filter((p) => p.status === "queued");
  const failed = paymentRows.filter((p) => p.status === "failed");

  const invoiceFor = (id: string) => invoiceRows.find((i) => i.id === id);
  const vendorName = (id: string) => vendors.find((v) => v.id === id)?.name ?? "—";

  return (
    <div className="flex flex-col gap-8 p-8">
      <div className="flex flex-col gap-2">
        <Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Payments" }]} />
        <div>
          <h1 className="font-serif text-lg text-foreground">Payment queue</h1>
          <p className="text-sm text-muted-foreground">
            Invoices that passed their checks and were approved for payment, waiting for somebody to actually send
            the money and record the reference.
            {failed.length > 0 && (
              <span className="text-destructive">
                {" "}
                {failed.length} {failed.length === 1 ? "payment needs" : "payments need"} attention.
              </span>
            )}
          </p>
        </div>
      </div>

      <PageHelp
        id="payments"
        title="How releasing a payment works"
        steps={{
          send: "Send the money through your bank as you normally would. AWA does not move money itself.",
          confirm:
            "Come back and confirm it, with the bank's reference, so the record shows what was actually paid and when.",
          failed:
            "If the bank rejected it, mark it failed with the reason — it stays here to be retried rather than quietly disappearing.",
        }}
      />

      <ListControls
        q={q}
        searchPlaceholder="UTR, invoice number, vendor, what it was for…"
        searchMatches={PAYMENT_SEARCH_FIELDS}
        clearHref={q ? "/dashboard/payments" : undefined}
        count={paymentRows.length}
      />

      {queued.length === 0 && failed.length === 0 ? (
        <EmptyState title={q ? `Nothing matches “${q}”` : "Nothing waiting to be paid"}>
          {q && <>Search covers {PAYMENT_SEARCH_FIELDS}, across payments queued or failed. </>}
          Invoices arrive here once they have been three-way matched and approved for payment.{" "}
          {awaitingApproval.length > 0 ? (
            <>
              {awaitingApproval.length} matched {awaitingApproval.length === 1 ? "invoice is" : "invoices are"}{" "}
              waiting for finance to approve {awaitingApproval.length === 1 ? "it" : "them"}.
            </>
          ) : (
            <>No invoices are matched and awaiting approval either.</>
          )}
          <div className="mt-3">
            <Link href="/dashboard/invoices" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              Go to invoices
            </Link>
          </div>
        </EmptyState>
      ) : (
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 pr-4 font-normal">Invoice</th>
            <th className="py-2 pr-4 font-normal">For</th>
            <th className="py-2 pr-4 font-normal">Vendor</th>
            <th className="py-2 pr-4 font-normal">Amount</th>
            <th className="py-2 pr-4 font-normal">Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {queued.length === 0 && (
            <tr>
              <td colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                Nothing queued for release — see the payments needing attention below.
              </td>
            </tr>
          )}
          {queued.map((p) => {
            const invoice = invoiceFor(p.invoiceId);
            return (
              <tr key={p.id} className="border-b align-top">
                <td className="py-2 pr-4">{invoice?.invoiceNumber ?? "—"}</td>
                <td className="py-2 pr-4">{labelForPayment(p.invoiceId)}</td>
                <td className="py-2 pr-4">{invoice ? vendorName(invoice.vendorId) : "—"}</td>
                <td className="py-2 pr-4 whitespace-nowrap">{p.amount} {p.currency}</td>
                <td className="py-2 pr-4"><LifecycleStatus stage="Payment queued" /></td>
                <td className="py-2">
                  <form action={releasePayment} className="flex items-end gap-2">
                    <input type="hidden" name="paymentId" value={p.id} />
                    <input
                      name="referenceNumber"
                      required
                      placeholder="Reference / UTR"
                      className="h-8 w-36 rounded-md border px-2 text-sm"
                    />
                    <button type="submit" className={cn(buttonVariants({ size: "sm" }))}>
                      Confirm sent
                    </button>
                    <Info
                      title="Confirm sent"
                      next="This closes the requisition it came from — the last step in the chain."
                    >
                      Records that you have already paid this through your bank. AWA does not move money; it
                      stores the reference so the payment can be traced later.
                    </Info>
                  </form>
                  <details className="mt-1.5 text-xs text-muted-foreground">
                    <summary className="cursor-pointer">Mark as failed</summary>
                    <form action={markPaymentFailed} className="mt-2 flex items-end gap-2">
                      <input type="hidden" name="paymentId" value={p.id} />
                      <input
                        name="reason"
                        required
                        placeholder="Why did it fail?"
                        className="h-8 w-44 rounded-md border px-2 text-sm"
                      />
                      <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                        Mark failed
                      </button>
                    </form>
                  </details>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      )}

      {failed.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-destructive">Needs attention</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 font-normal">Invoice</th>
                <th className="py-2 font-normal">Vendor</th>
                <th className="py-2 font-normal">Amount</th>
                <th className="py-2 font-normal">Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {failed.map((p) => {
                const invoice = invoiceFor(p.invoiceId);
                return (
                  <tr key={p.id} className="border-b align-top">
                    <td className="py-2">{invoice?.invoiceNumber ?? "—"}</td>
                    <td className="py-2">{invoice ? vendorName(invoice.vendorId) : "—"}</td>
                    <td className="py-2">{p.amount} {p.currency}</td>
                    <td className="py-2">
                      <LifecycleStatus stage="Payment failed" />
                      {p.failureReason && <p className="mt-0.5 max-w-xs text-xs text-muted-foreground">{p.failureReason}</p>}
                    </td>
                    <td className="py-2">
                      <form action={retryPayment}>
                        <input type="hidden" name="paymentId" value={p.id} />
                        <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                          Retry
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
