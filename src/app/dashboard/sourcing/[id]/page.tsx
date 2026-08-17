import Link from "next/link";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import {
  purchaseRequisitions as purchaseRequisitionsTable,
  purchaseRequisitionLines as purchaseRequisitionLinesTable,
  rfqs as rfqsTable,
  rfqVendorInvitations as invitationsTable,
  vendorQuotations as quotationsTable,
  vendors as vendorsTable,
  purchaseOrders as purchaseOrdersTable,
} from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { cn } from "@/lib/utils";
import { computeStage } from "@/lib/lifecycle";
import { LifecycleStatus } from "@/components/ui/lifecycle-status";
import { LifecycleRail } from "@/components/ui/lifecycle-rail";
import { createRfq, inviteVendor, submitQuotation, selectQuotationAndIssuePo } from "./actions";

export default async function SourcingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { tenant } = await getCurrentUserAndTenant();

  const [requisition, lines, rfq, invitations, quotations, vendors, po] = await withTenant(tenant.id, async (tx) => {
    const [requisitionRow] = await tx.select().from(purchaseRequisitionsTable).where(eq(purchaseRequisitionsTable.id, id));
    const [rfqRow] = requisitionRow
      ? await tx.select().from(rfqsTable).where(eq(rfqsTable.requisitionId, id))
      : [undefined];

    return [
      requisitionRow ?? null,
      requisitionRow ? await tx.select().from(purchaseRequisitionLinesTable).where(eq(purchaseRequisitionLinesTable.requisitionId, id)) : [],
      rfqRow ?? null,
      rfqRow ? await tx.select().from(invitationsTable).where(eq(invitationsTable.rfqId, rfqRow.id)) : [],
      rfqRow ? await tx.select().from(quotationsTable).where(eq(quotationsTable.rfqId, rfqRow.id)) : [],
      requisitionRow ? await tx.select().from(vendorsTable) : [],
      requisitionRow ? (await tx.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.requisitionId, id)))[0] ?? null : null,
    ] as const;
  });

  if (!requisition) notFound();

  // No invoice or payment loaded here — computeStage walks only as far as
  // the data it is given, which for a sourcing screen stops at the PO.
  const stage = computeStage(requisition, rfq ? [rfq] : [], po ?? undefined, undefined, undefined);
  const vendorName = (vendorId: string) => vendors.find((v) => v.id === vendorId)?.name ?? "—";
  const invitedVendorIds = new Set(invitations.map((i) => i.vendorId));
  const uninvitedVendors = vendors.filter((v) => v.status === "active" && !invitedVendorIds.has(v.id));

  return (
    <div className="flex flex-col gap-8 p-8">
      <div className="flex flex-col gap-2">
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Sourcing", href: "/dashboard/sourcing" },
            { label: "Source requisition" },
          ]}
        />
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-serif text-lg text-foreground">Source requisition</h1>
            <p className="text-sm text-muted-foreground">
              {requisition.totalEstimatedValue} {requisition.currency}
            </p>
          </div>
          <LifecycleStatus stage={stage} className="shrink-0 items-end text-right" />
        </div>
      </div>

      <div className="rounded-lg border border-border p-4">
        <LifecycleRail
          stage={stage}
          captions={{
            sourcing: quotations.length
              ? `${quotations.length} quotation${quotations.length === 1 ? "" : "s"}`
              : rfq
                ? "No quotations yet"
                : "Not started",
            purchase_order: po ? po.poNumber : "Not issued",
          }}
        />
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">Lines</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {lines.map((l) => (
            <li key={l.id}>
              {l.freeTextDescription ?? "Catalog item"} — {l.quantity} {l.uom} @ {l.estimatedUnitPrice} = {l.lineTotal}
            </li>
          ))}
        </ul>
      </section>

      {po ? (
        <section className="flex flex-col gap-2 rounded-md border p-4">
          <h2 className="text-sm font-medium">PO {po.poNumber} — issued</h2>
          <p className="text-sm text-muted-foreground">
            {vendorName(po.vendorId)} — {po.totalAmount} {po.currency}
          </p>
          <div className="flex gap-2">
            <a
              href={`/dashboard/sourcing/${requisition.id}/po/${po.id}/pdf`}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-fit")}
            >
              Download PDF
            </a>
            <a
              href={`/po-verify/${po.qrToken}`}
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-fit")}
            >
              View what the vendor sees
            </a>
          </div>
        </section>
      ) : !rfq ? (
        <form action={createRfq}>
          <input type="hidden" name="requisitionId" value={requisition.id} />
          <button type="submit" className={cn(buttonVariants())}>Create RFQ</button>
        </form>
      ) : (
        <section className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-medium text-muted-foreground">Invited vendors</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 font-normal">Vendor</th>
                  <th className="py-2 font-normal">Status</th>
                  <th className="py-2 font-normal">Quotation</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((inv) => {
                  const quotation = quotations.find((q) => q.vendorId === inv.vendorId && q.status !== "rejected");
                  return (
                    <tr key={inv.id} className="border-b align-top">
                      <td className="py-2">{vendorName(inv.vendorId)}</td>
                      <td className="py-2">{inv.status}</td>
                      <td className="py-2">
                        {quotation ? (
                          `${quotation.totalAmount} ${quotation.currency}${quotation.status === "selected" ? " (selected)" : ""}`
                        ) : (
                          <form action={submitQuotation} className="flex items-end gap-1">
                            <input type="hidden" name="rfqId" value={rfq.id} />
                            <input type="hidden" name="vendorId" value={inv.vendorId} />
                            <input type="hidden" name="requisitionId" value={requisition.id} />
                            <input name="totalAmount" type="number" step="0.01" placeholder="Amount" className="h-7 w-24 rounded-md border px-1.5 text-xs" />
                            <input name="validUntil" type="date" className="h-7 rounded-md border px-1.5 text-xs" />
                            <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>Record quote</button>
                          </form>
                        )}
                      </td>
                      <td className="py-2">
                        {quotation && quotation.status === "submitted" && (
                          <form action={selectQuotationAndIssuePo}>
                            <input type="hidden" name="requisitionId" value={requisition.id} />
                            <input type="hidden" name="vendorId" value={inv.vendorId} />
                            <input type="hidden" name="quotationId" value={quotation.id} />
                            <button type="submit" className={cn(buttonVariants({ size: "sm" }))}>Select &amp; issue PO</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <form action={inviteVendor} className="flex items-end gap-2">
              <input type="hidden" name="rfqId" value={rfq.id} />
              <input type="hidden" name="requisitionId" value={requisition.id} />
              <select name="vendorId" required className="h-8 rounded-md border px-2 text-sm">
                {uninvitedVendors.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
              <button type="submit" className={cn(buttonVariants({ variant: "outline" }))}>Invite vendor</button>
            </form>
          </div>
        </section>
      )}

      <Link href="/dashboard/sourcing" className="text-xs text-muted-foreground hover:text-foreground w-fit">
        ← Back to sourcing list
      </Link>
    </div>
  );
}
