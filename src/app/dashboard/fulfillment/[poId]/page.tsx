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
} from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { submitGoodsReceipt, submitServiceAcceptance } from "./actions";

export default async function FulfillmentDetailPage({ params }: { params: Promise<{ poId: string }> }) {
  const { poId } = await params;
  const { tenant } = await getCurrentUserAndTenant();

  const [po, lines, catalogItems, users, grnLines, serviceLines] = await withTenant(tenant.id, async (tx) => {
    const [po] = await tx.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, poId));
    if (!po) return [null, [], [], [], [], []] as const;

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

    return [po, lines, catalogItems, users, grnLines, serviceLines] as const;
  });

  if (!po) notFound();

  const [vendor, requisition] = await withTenant(tenant.id, async (tx) => {
    const [vendor] = await tx.select().from(vendorsTable).where(eq(vendorsTable.id, po.vendorId));
    const [requisition] = await tx.select().from(purchaseRequisitionsTable).where(eq(purchaseRequisitionsTable.id, po.requisitionId));
    return [vendor ?? null, requisition ?? null];
  });

  const itemName = (itemId: string | null) => catalogItems.find((i) => i.id === itemId)?.name ?? null;
  const receiverOptions = users.filter((u) => u.id !== requisition?.requestorId);

  const goodsLines = lines.filter((l) => l.fulfillmentType === "goods");
  const openGoodsLines = goodsLines.filter((l) => l.status !== "fulfilled");
  const serviceLinesOnPo = lines.filter((l) => l.fulfillmentType === "service");
  const openServiceLines = serviceLinesOnPo.filter((l) => l.status !== "fulfilled");

  return (
    <div className="flex flex-col gap-8 p-8">
      <div>
        <h1 className="text-lg font-medium">{po.poNumber}</h1>
        <p className="text-sm text-muted-foreground">
          {vendor?.name ?? "—"} · {po.totalAmount} {po.currency} · {po.status}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {po.vendorConfirmedAt
            ? `Vendor confirmed via portal on ${po.vendorConfirmedAt.toISOString().slice(0, 10)}`
            : "Not yet confirmed by the vendor in the vendor portal"}
        </p>
      </div>

      {goodsLines.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">Goods</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {goodsLines.map((l) => {
              const receipt = grnLines.find((g) => g.poLineId === l.id);
              return (
                <li key={l.id}>
                  {itemName(l.itemId) ?? "Item"} — {l.quantity} {l.uom}
                  {receipt && (
                    <span className="text-muted-foreground">
                      {" "}
                      · received {receipt.quantityAccepted} accepted, {receipt.quantityRejected} rejected ({receipt.condition})
                    </span>
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
                  {openGoodsLines.map((l) => (
                    <tr key={l.id} className="border-b">
                      <td className="py-2">
                        {itemName(l.itemId) ?? "Item"}
                        <input type="hidden" name="poLineId" value={l.id} />
                      </td>
                      <td className="py-2">
                        <input name="quantityDelivered" type="number" step="0.001" defaultValue={l.quantity} className="h-8 w-20 rounded-md border px-2 text-sm" />
                      </td>
                      <td className="py-2">
                        <input name="quantityAccepted" type="number" step="0.001" defaultValue={l.quantity} className="h-8 w-20 rounded-md border px-2 text-sm" />
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
                  ))}
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
              const acceptance = serviceLines.find((s) => s.poLineId === l.id);
              return (
                <li key={l.id}>
                  {l.serviceDescription ?? "Service"} — {l.lineTotal} {po.currency}
                  {acceptance && <span className="text-muted-foreground"> · {acceptance.status}</span>}
                </li>
              );
            })}
          </ul>

          {openServiceLines.length > 0 && (
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
          )}
        </section>
      )}
    </div>
  );
}
