import { notFound } from "next/navigation";
import { getCurrentVendorUser } from "@/db/vendorSession";
import { withTenant } from "@/db/withTenant";
import { getVendorPoDetail } from "@/db/vendorPortal";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { confirmPo } from "./actions";

export default async function VendorPoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vendorUser = await getCurrentVendorUser();

  const detail = await withTenant(vendorUser.tenantId, (tx) => getVendorPoDetail(tx, vendorUser.vendorId, id));
  if (!detail) notFound();

  const { po, lines, items, signatory } = detail;
  const itemName = (itemId: string | null) => items.find((i) => i.id === itemId)?.name ?? null;

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <h1 className="text-lg font-medium">{po.poNumber}</h1>
        <p className="text-sm text-muted-foreground">
          {po.totalAmount} {po.currency} · {po.status}
        </p>
      </div>

      {po.status === "cancelled" && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          This PO has been cancelled. Do not fulfill it.
        </p>
      )}

      {signatory ? (
        <p className="text-sm">
          Signed by <strong>{signatory.name}</strong>, {signatory.title} — a registered authorized signatory at{" "}
          {vendorUser.tenantName}.
        </p>
      ) : (
        <p className="text-sm text-amber-600">
          No registered authorized signatory matched this PO. Confirm directly with {vendorUser.tenantName} before
          proceeding.
        </p>
      )}

      {po.documentHash && (
        <p className="break-all text-xs text-muted-foreground">Document hash: {po.documentHash}</p>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 font-normal">Line</th>
            <th className="py-2 font-normal">Qty</th>
            <th className="py-2 font-normal">Unit price</th>
            <th className="py-2 font-normal">Total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-b">
              <td className="py-2">{l.fulfillmentType === "goods" ? itemName(l.itemId) ?? "Item" : l.serviceDescription ?? "Service"}</td>
              <td className="py-2">{l.quantity} {l.uom}</td>
              <td className="py-2">{l.unitPrice}</td>
              <td className="py-2">{l.lineTotal}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {po.vendorConfirmedAt ? (
        <p className="text-sm text-emerald-600">
          Confirmed on {po.vendorConfirmedAt.toISOString().slice(0, 10)} — this is on record as the vendor&apos;s own
          acknowledgment, not just the emailed PDF.
        </p>
      ) : po.status !== "cancelled" ? (
        <form action={confirmPo} className="w-fit">
          <input type="hidden" name="poId" value={po.id} />
          <button type="submit" className={cn(buttonVariants())}>Confirm this PO</button>
        </form>
      ) : null}
    </div>
  );
}
