import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import {
  purchaseOrders as purchaseOrdersTable,
  purchaseOrderLines as purchaseOrderLinesTable,
  purchaseRequisitions as purchaseRequisitionsTable,
  vendors as vendorsTable,
  users as usersTable,
  catalogItems as catalogItemsTable,
  goodsReceiptLines as goodsReceiptLinesTable,
  serviceAcceptanceLines as serviceAcceptanceLinesTable,
  serviceMilestones as serviceMilestonesTable,
  vendorReturns as vendorReturnsTable,
  invoices as invoicesTable,
  paymentInstructions as paymentInstructionsTable,
} from "@/db/schema";
import { VENDOR_RETURN_STATUSES } from "@/db/vendorReturns";
import { resolveMilestoneValue } from "@/db/serviceMilestones";
import { buttonVariants } from "@/components/ui/button";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { cn } from "@/lib/utils";
import { poStage, PAYMENT_CAPTIONS } from "@/lib/lifecycle";
import { LifecycleStatus } from "@/components/ui/lifecycle-status";
import { LifecycleRail } from "@/components/ui/lifecycle-rail";
import { advanceReturn, defineMilestone, initiateReturn, submitGoodsReceipt, submitMilestoneAcceptance, submitServiceAcceptance } from "./actions";

export default async function FulfillmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ poId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { poId } = await params;
  const { error } = await searchParams;
  const { tenant } = await getCurrentUserAndTenant();

  const [po, lines, catalogItems, users, grnLines, serviceLines, returns, milestones] = await withTenant(tenant.id, async (tx) => {
    const [po] = await tx.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, poId));
    if (!po) return [null, [], [], [], [], [], [], []] as const;

    const lines = await tx.select().from(purchaseOrderLinesTable).where(eq(purchaseOrderLinesTable.poId, poId));
    const catalogItems = await tx.select().from(catalogItemsTable);
    const users = await tx.select().from(usersTable);
    const goodsLineIds = lines.filter((l) => l.fulfillmentType === "goods").map((l) => l.id);
    const serviceLineIds = lines.filter((l) => l.fulfillmentType === "service").map((l) => l.id);
    const grnLines = goodsLineIds.length
      ? (await tx.select().from(goodsReceiptLinesTable)).filter((g) => goodsLineIds.includes(g.poLineId))
      : [];
    const serviceLines = serviceLineIds.length
      ? (await tx.select().from(serviceAcceptanceLinesTable)).filter((s) => serviceLineIds.includes(s.poLineId))
      : [];
    const grnLineIds = grnLines.map((g) => g.id);
    const returns = grnLineIds.length
      ? (await tx.select().from(vendorReturnsTable)).filter((r) => grnLineIds.includes(r.grnLineId))
      : [];
    const milestones = serviceLineIds.length
      ? await tx.select().from(serviceMilestonesTable).where(eq(serviceMilestonesTable.poId, poId))
      : [];

    return [po, lines, catalogItems, users, grnLines, serviceLines, returns, milestones] as const;
  });

  if (!po) notFound();

  const [vendor, requisition, invoice, payment] = await withTenant(tenant.id, async (tx) => {
    const [vendor] = await tx.select().from(vendorsTable).where(eq(vendorsTable.id, po.vendorId));
    const [requisition] = await tx.select().from(purchaseRequisitionsTable).where(eq(purchaseRequisitionsTable.id, po.requisitionId));
    const [invoice] = await tx.select().from(invoicesTable).where(eq(invoicesTable.poId, po.id));
    const [payment] = invoice ? await tx.select().from(paymentInstructionsTable).where(eq(paymentInstructionsTable.invoiceId, invoice.id)) : [];
    return [vendor ?? null, requisition ?? null, invoice ?? undefined, payment ?? undefined];
  });

  const itemName = (l: { itemId: string | null; serviceDescription: string | null }) =>
    catalogItems.find((i) => i.id === l.itemId)?.name ?? l.serviceDescription ?? "Item";
  const receiverOptions = users.filter((u) => u.id !== requisition?.requestorId);

  const goodsLines = lines.filter((l) => l.fulfillmentType === "goods");
  const openGoodsLines = goodsLines.filter((l) => l.status !== "fulfilled");
  const serviceLinesOnPo = lines.filter((l) => l.fulfillmentType === "service");
  const openServiceLines = serviceLinesOnPo.filter((l) => l.status !== "fulfilled");

  const receiptsFor = (lineId: string) => grnLines.filter((g) => g.poLineId === lineId);
  const totalAccepted = (lineId: string) => receiptsFor(lineId).reduce((sum, g) => sum + Number(g.quantityAccepted), 0);
  const returnsFor = (grnLineId: string) => returns.filter((r) => r.grnLineId === grnLineId);
  const returnedQty = (grnLineId: string) => returnsFor(grnLineId).reduce((sum, r) => sum + Number(r.quantity), 0);
  const nextReturnStep = (status: string) => {
    const idx = VENDOR_RETURN_STATUSES.indexOf(status as (typeof VENDOR_RETURN_STATUSES)[number]);
    return idx >= 0 && idx < VENDOR_RETURN_STATUSES.length - 1 ? VENDOR_RETURN_STATUSES[idx + 1] : null;
  };
  const milestonesForPo = [...milestones].sort((a, b) => a.milestoneNo - b.milestoneNo);
  const acceptedMilestoneIdsFor = (lineId: string) =>
    new Set(
      serviceLines
        .filter((s) => s.poLineId === lineId && s.status === "accepted" && s.milestoneId)
        .map((s) => s.milestoneId!),
    );
  const openMilestonesFor = (lineId: string) => {
    const accepted = acceptedMilestoneIdsFor(lineId);
    return milestonesForPo.filter((m) => !accepted.has(m.id));
  };

  return (
    <div className="flex flex-col gap-8 p-8">
      <div className="flex flex-col gap-2">
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Fulfillment", href: "/dashboard/fulfillment" },
            { label: po.poNumber },
          ]}
        />
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-serif text-lg text-foreground">{po.poNumber}</h1>
            <p className="text-sm text-muted-foreground">
              {vendor?.name ?? "—"} · {po.totalAmount} {po.currency}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {po.vendorConfirmedAt
                ? `Vendor confirmed via portal on ${po.vendorConfirmedAt.toISOString().slice(0, 10)}`
                : "Not yet confirmed by the vendor in the vendor portal"}
            </p>
          </div>
          <LifecycleStatus stage={poStage(po, invoice, payment)} className="shrink-0 items-end text-right" />
        </div>
      </div>

      {/* Receiving is the stage most often done by somebody who touches
          AWA once a month — a storeman, not a buyer. The rail is how they
          see that recording this is what unblocks the invoice behind it. */}
      <div className="rounded-lg border border-border p-4">
        <LifecycleRail
          stage={poStage(po, invoice, payment)}
          captions={{
            purchase_order: po.poNumber,
            invoice: invoice ? invoice.invoiceNumber : "Not submitted",
            payment: payment ? PAYMENT_CAPTIONS[payment.status] : "—",
          }}
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {goodsLines.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">Goods</h2>
          <ul className="flex flex-col gap-3 text-sm">
            {goodsLines.map((l) => {
              const receipts = receiptsFor(l.id);
              const accepted = totalAccepted(l.id);
              return (
                <li key={l.id}>
                  <div>
                    {itemName(l)} — {l.quantity} {l.uom} ordered
                    {receipts.length > 0 && (
                      <span className="text-muted-foreground"> · {accepted} accepted so far ({l.status})</span>
                    )}
                  </div>

                  {receipts.length > 0 && (
                    <ul className="ml-4 mt-1 flex flex-col gap-2 text-xs text-muted-foreground">
                      {receipts.map((r) => {
                        const alreadyReturned = returnedQty(r.id);
                        const returnableQty = Number(r.quantityRejected) - alreadyReturned;
                        return (
                          <li key={r.id}>
                            <div>
                              received {r.quantityDelivered}, accepted {r.quantityAccepted}, rejected {r.quantityRejected} ({r.condition})
                              {r.rejectionReason && ` — ${r.rejectionReason}`}
                            </div>

                            {returnsFor(r.id).map((ret) => {
                              const step = nextReturnStep(ret.status);
                              return (
                                <div key={ret.id} className="mt-1 flex flex-wrap items-center gap-2">
                                  <span>
                                    return of {ret.quantity}: <strong>{ret.status}</strong>
                                    {ret.returnShipmentRef && ` · shipment ${ret.returnShipmentRef}`}
                                    {ret.creditNoteRef && ` · credit note ${ret.creditNoteRef}`}
                                  </span>
                                  {step && (
                                    <form action={advanceReturn} className="flex items-center gap-1">
                                      <input type="hidden" name="poId" value={po.id} />
                                      <input type="hidden" name="returnId" value={ret.id} />
                                      <input type="hidden" name="nextStatus" value={step} />
                                      {(step === "shipped" || step === "credited") && (
                                        <input
                                          name="reference"
                                          placeholder={step === "shipped" ? "shipment ref" : "credit note ref"}
                                          required
                                          className="h-7 w-32 rounded-md border px-1.5 text-xs"
                                        />
                                      )}
                                      <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                                        Mark {step}
                                      </button>
                                    </form>
                                  )}
                                </div>
                              );
                            })}

                            {returnableQty > 1e-9 && (
                              <form action={initiateReturn} className="mt-1 flex flex-wrap items-center gap-1">
                                <input type="hidden" name="poId" value={po.id} />
                                <input type="hidden" name="grnLineId" value={r.id} />
                                <input
                                  name="quantity"
                                  type="number"
                                  step="0.001"
                                  defaultValue={returnableQty}
                                  max={returnableQty}
                                  className="h-7 w-16 rounded-md border px-1.5 text-xs"
                                />
                                <input name="reason" placeholder="return reason" required className="h-7 w-40 rounded-md border px-1.5 text-xs" />
                                <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                                  Initiate return
                                </button>
                              </form>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>

          {openGoodsLines.length > 0 && (
            <form action={submitGoodsReceipt} className="flex flex-col gap-3 rounded-md border p-4">
              <input type="hidden" name="poId" value={po.id} />
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Received by</label>
                  <select name="receivedBy" required className="h-8 rounded-md border px-2 text-sm">
                    {receiverOptions.map((u) => (
                      <option key={u.id} value={u.id}>{u.fullName}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Delivery note ref</label>
                  <input name="deliveryNoteRef" className="h-8 rounded-md border px-2 text-sm" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Defaults below assume the full remaining balance arrives in this shipment — adjust for a partial or
                short delivery, the line stays open for the rest either way.
              </p>

              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 font-normal">Item</th>
                    <th className="py-2 font-normal">Delivered</th>
                    <th className="py-2 font-normal">Accepted</th>
                    <th className="py-2 font-normal">Rejected</th>
                    <th className="py-2 font-normal">Condition</th>
                    <th className="py-2 font-normal">Rejection reason</th>
                  </tr>
                </thead>
                <tbody>
                  {openGoodsLines.map((l) => {
                    const remaining = Math.max(Number(l.quantity) - totalAccepted(l.id), 0);
                    return (
                      <tr key={l.id} className="border-b">
                        <td className="py-2">
                          {itemName(l)}
                          <input type="hidden" name="poLineId" value={l.id} />
                        </td>
                        <td className="py-2">
                          <input name="quantityDelivered" type="number" step="0.001" defaultValue={remaining} className="h-8 w-20 rounded-md border px-2 text-sm" />
                        </td>
                        <td className="py-2">
                          <input name="quantityAccepted" type="number" step="0.001" defaultValue={remaining} className="h-8 w-20 rounded-md border px-2 text-sm" />
                        </td>
                        <td className="py-2">
                          <input name="quantityRejected" type="number" step="0.001" defaultValue="0" className="h-8 w-20 rounded-md border px-2 text-sm" />
                        </td>
                        <td className="py-2">
                          <select name="condition" defaultValue="good" className="h-8 rounded-md border px-2 text-sm">
                            <option value="good">Good</option>
                            <option value="damaged">Damaged</option>
                            <option value="short">Short</option>
                          </select>
                        </td>
                        <td className="py-2">
                          <input name="rejectionReason" className="h-8 w-40 rounded-md border px-2 text-sm" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <button type="submit" className={cn(buttonVariants(), "w-fit")}>Record receipt</button>
            </form>
          )}
        </section>
      )}

      {serviceLinesOnPo.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">Services</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {serviceLinesOnPo.map((l) => {
              const acceptance = serviceLines.filter((s) => s.poLineId === l.id).slice(-1)[0];
              const acceptedCount = acceptedMilestoneIdsFor(l.id).size;
              return (
                <li key={l.id}>
                  {l.serviceDescription ?? "Service"} — {l.lineTotal} {po.currency}
                  {milestonesForPo.length > 0 ? (
                    <span className="text-muted-foreground"> · {acceptedCount}/{milestonesForPo.length} milestones accepted ({l.status})</span>
                  ) : (
                    acceptance && <span className="text-muted-foreground"> · {acceptance.status}</span>
                  )}
                </li>
              );
            })}
          </ul>

          {milestonesForPo.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-md border p-3 text-xs text-muted-foreground">
              {milestonesForPo.map((m) => (
                <li key={m.id}>
                  #{m.milestoneNo} {m.description} — {resolveMilestoneValue(m, po.totalAmount).toFixed(2)} {po.currency}
                  {m.percentOfValue !== null && ` (${m.percentOfValue}% of PO)`}
                  {m.dueDate && ` · due ${m.dueDate}`}
                </li>
              ))}
            </ul>
          )}

          {milestonesForPo.length > 0 ? (
            openServiceLines.some((l) => openMilestonesFor(l.id).length > 0) && (
              <form action={submitMilestoneAcceptance} className="flex flex-col gap-3 rounded-md border p-4">
                <input type="hidden" name="poId" value={po.id} />
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 font-normal">Service</th>
                      <th className="py-2 font-normal">Milestone</th>
                      <th className="py-2 font-normal">Accepted value</th>
                      <th className="py-2 font-normal">Status</th>
                      <th className="py-2 font-normal">Rejection reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openServiceLines.flatMap((l) =>
                      openMilestonesFor(l.id).map((m) => (
                        <tr key={`${l.id}-${m.id}`} className="border-b">
                          <td className="py-2">
                            {l.serviceDescription ?? "Service"}
                            <input type="hidden" name="poLineId" value={l.id} />
                          </td>
                          <td className="py-2">
                            #{m.milestoneNo} {m.description}
                            <input type="hidden" name="milestoneId" value={m.id} />
                          </td>
                          <td className="py-2">
                            <input
                              name="acceptedValue"
                              type="number"
                              step="0.01"
                              defaultValue={resolveMilestoneValue(m, po.totalAmount).toFixed(2)}
                              className="h-8 w-24 rounded-md border px-2 text-sm"
                            />
                          </td>
                          <td className="py-2">
                            <select name="status" defaultValue="accepted" className="h-8 rounded-md border px-2 text-sm">
                              <option value="accepted">Accepted</option>
                              <option value="rejected">Rejected</option>
                              <option value="partial">Partial</option>
                            </select>
                          </td>
                          <td className="py-2">
                            <input name="rejectionReason" className="h-8 w-40 rounded-md border px-2 text-sm" />
                          </td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>

                <button type="submit" className={cn(buttonVariants(), "w-fit")}>Record milestone acceptance</button>
              </form>
            )
          ) : (
            openServiceLines.length > 0 && (
              <form action={submitServiceAcceptance} className="flex flex-col gap-3 rounded-md border p-4">
                <input type="hidden" name="poId" value={po.id} />
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 font-normal">Service</th>
                      <th className="py-2 font-normal">Accepted value</th>
                      <th className="py-2 font-normal">Status</th>
                      <th className="py-2 font-normal">Rejection reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openServiceLines.map((l) => (
                      <tr key={l.id} className="border-b">
                        <td className="py-2">
                          {l.serviceDescription ?? "Service"}
                          <input type="hidden" name="poLineId" value={l.id} />
                        </td>
                        <td className="py-2">
                          <input name="acceptedValue" type="number" step="0.01" defaultValue={l.lineTotal} className="h-8 w-24 rounded-md border px-2 text-sm" />
                        </td>
                        <td className="py-2">
                          <select name="status" defaultValue="accepted" className="h-8 rounded-md border px-2 text-sm">
                            <option value="accepted">Accepted</option>
                            <option value="rejected">Rejected</option>
                            <option value="partial">Partial</option>
                          </select>
                        </td>
                        <td className="py-2">
                          <input name="rejectionReason" className="h-8 w-40 rounded-md border px-2 text-sm" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <button type="submit" className={cn(buttonVariants(), "w-fit")}>Record acceptance</button>
              </form>
            )
          )}

          <form action={defineMilestone} className="flex flex-wrap items-end gap-2 rounded-md border border-dashed p-3">
            <input type="hidden" name="poId" value={po.id} />
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">No.</label>
              <input name="milestoneNo" type="number" min="1" required className="h-8 w-16 rounded-md border px-2 text-sm" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Description</label>
              <input name="description" required className="h-8 w-48 rounded-md border px-2 text-sm" placeholder="e.g. Design sign-off" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Value type</label>
              <select name="valueType" defaultValue="percent" className="h-8 rounded-md border px-2 text-sm">
                <option value="percent">% of PO</option>
                <option value="fixed">Fixed amount</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Value</label>
              <input name="value" type="number" step="0.01" required className="h-8 w-24 rounded-md border px-2 text-sm" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Due date</label>
              <input name="dueDate" type="date" className="h-8 rounded-md border px-2 text-sm" />
            </div>
            <button type="submit" className={cn(buttonVariants({ variant: "outline" }))}>Add milestone</button>
          </form>
        </section>
      )}
    </div>
  );
}
