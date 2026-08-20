import Link from "next/link";
import { getCurrentVendorUser } from "@/db/vendorSession";
import { withTenant } from "@/db/withTenant";
import { listVendorPos } from "@/db/vendorPortal";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { vendorLogout } from "./actions";
import { confirmPo } from "./po/[id]/actions";

/**
 * Turns the raw status enum (`partially_fulfilled`) into a sentence
 * describing what's owed and by whom — same status data already on the
 * row (listVendorPos selects the full purchase_orders row), no new
 * query. Per-item detail (what was ordered, delivery date) stays on the
 * detail page, which already loads the lines this list query doesn't.
 */
function statusSentence(po: { status: string; vendorConfirmedAt: Date | null }): string {
  if (po.status === "cancelled") return "Cancelled — no action needed.";
  if (po.status === "fulfilled") return "Everything has been delivered.";
  if (po.status === "partially_fulfilled") return "Part of this order has arrived — the rest is still owed.";
  if (!po.vendorConfirmedAt) return "Waiting for you to confirm you can supply this.";
  return "Confirmed — deliver when ready.";
}

export default async function VendorPortalHome() {
  const vendorUser = await getCurrentVendorUser();
  const pos = await withTenant(vendorUser.tenantId, (tx) => listVendorPos(tx, vendorUser.vendorId));

  // Confirming supply capability only makes sense before fulfillment has
  // started — a PO that's already partially or fully delivered without
  // ever being explicitly confirmed shouldn't get the same "needs your
  // confirmation" hero treatment as a freshly issued one; it just reads
  // its ordinary status sentence below instead.
  const needsConfirmation = pos.filter((po) => po.status === "issued" && !po.vendorConfirmedAt);
  const rest = pos.filter((po) => !needsConfirmation.includes(po));

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl text-foreground">Orders from {vendorUser.tenantName}</h1>
          <p className="mt-1 max-w-[70ch] text-sm leading-relaxed text-muted-foreground">
            You&apos;re signed in as {vendorUser.vendorUserEmail} for <strong className="font-medium text-foreground">{vendorUser.vendorName}</strong>. This
            page is the real order — if an emailed PDF ever disagrees with what&apos;s here, what&apos;s here is
            correct.
          </p>
        </div>
        <form action={vendorLogout} className="shrink-0">
          <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            Sign out
          </button>
        </form>
      </div>

      {pos.length === 0 && (
        <p className="rounded-lg border border-dashed border-input p-8 text-center text-sm text-muted-foreground">
          No purchase orders yet.
        </p>
      )}

      {needsConfirmation.map((po) => (
        <Card key={po.id} className="border-primary/35 bg-primary/5 p-5">
          <div className="flex flex-wrap items-baseline gap-2.5">
            <p className="text-base font-medium">
              {po.poNumber} · {po.totalAmount} {po.currency}
            </p>
            <span className="rounded-full bg-primary/16 px-2.5 py-0.5 text-[11.5px] font-medium text-primary">
              needs your confirmation
            </span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{statusSentence(po)}</p>
          <div className="mt-3.5 flex flex-wrap gap-2.5">
            <form action={confirmPo}>
              <input type="hidden" name="poId" value={po.id} />
              <button type="submit" className={cn(buttonVariants())}>
                Yes — we can supply this
              </button>
            </form>
            <Link href={`/vendor-portal/po/${po.id}`} className={cn(buttonVariants({ variant: "outline" }))}>
              View the order
            </Link>
          </div>
        </Card>
      ))}

      {rest.map((po) => {
        const finished = po.status === "fulfilled" || po.status === "cancelled";
        return (
          <Card key={po.id} className={cn("p-5", finished && "bg-muted/50")}>
            <div className="flex flex-wrap items-baseline gap-2.5">
              <p className="text-sm font-medium">
                {po.poNumber} · {po.totalAmount} {po.currency}
              </p>
              {po.status === "partially_fulfilled" && (
                <span className="rounded-full bg-chart-1/10 px-2.5 py-0.5 text-[11.5px] font-medium text-chart-1">
                  part delivered
                </span>
              )}
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">{statusSentence(po)}</p>
            <Link
              href={`/vendor-portal/po/${po.id}`}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-3")}
            >
              See it
            </Link>
          </Card>
        );
      })}

      <p className="max-w-[80ch] text-xs leading-relaxed text-muted-foreground">
        A note on bank details: {vendorUser.tenantName} will never ask you to change your account details by email
        or through this page. If you need to change them, their finance team will call you back on a number they
        already hold.
      </p>
    </div>
  );
}
