import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { getCurrentVendorUser } from "@/db/vendorSession";
import { withTenant } from "@/db/withTenant";
import { getVendorPoDetail } from "@/db/vendorPortal";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getAppOrigin } from "@/lib/appOrigin";
import { cn } from "@/lib/utils";
import { confirmPo } from "./actions";

export default async function VendorPoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vendorUser = await getCurrentVendorUser();

  const detail = await withTenant(vendorUser.tenantId, (tx) => getVendorPoDetail(tx, vendorUser.vendorId, id));
  if (!detail) notFound();

  const { po, lines, items, signatory } = detail;
  const itemName = (itemId: string | null) => items.find((i) => i.id === itemId)?.name ?? null;

  // Same QR/hash pair already printed on the issued PDF (db/poPdf.ts) —
  // surfaced here too, so a vendor checking the order doesn't have to
  // trust a PDF that arrived by email to see it.
  const verifyUrl = po.qrToken ? `${await getAppOrigin()}/po-verify/${po.qrToken}` : null;
  const qrDataUrl = verifyUrl ? await QRCode.toDataURL(verifyUrl, { margin: 0 }) : null;

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

      {(po.documentHash || qrDataUrl) && (
        <Card className="flex max-w-md items-start gap-4 bg-muted/40 p-3.5">
          {qrDataUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- a data: URI, not an optimizable remote image
            <img src={qrDataUrl} alt="" width={72} height={72} className="shrink-0 rounded-md bg-white p-1" />
          )}
          <div className="min-w-0">
            <p className="text-[11px] tracking-[0.07em] text-muted-foreground uppercase">Is this genuine?</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Every AWA order carries a QR code and a fingerprint. Scan it, or check it below, and you&apos;ll see
              the same figures as on this page.
            </p>
            {po.documentHash && (
              <p className="mt-1.5 truncate font-mono text-[11px] text-muted-foreground">{po.documentHash}</p>
            )}
            {verifyUrl && (
              <a href={verifyUrl} className="mt-1.5 inline-block text-xs text-primary underline underline-offset-2">
                Check this order
              </a>
            )}
          </div>
        </Card>
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
