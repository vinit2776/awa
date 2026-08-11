import Link from "next/link";
import { getCurrentVendorUser } from "@/db/vendorSession";
import { withTenant } from "@/db/withTenant";
import { listVendorPos } from "@/db/vendorPortal";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { vendorLogout } from "./actions";

export default async function VendorPortalHome() {
  const vendorUser = await getCurrentVendorUser();
  const pos = await withTenant(vendorUser.tenantId, (tx) => listVendorPos(tx, vendorUser.vendorId));

  return (
    <div className="flex flex-col gap-8 p-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-medium">{vendorUser.vendorName}</h1>
          <p className="text-sm text-muted-foreground">
            Purchase orders from {vendorUser.tenantName} · signed in as {vendorUser.vendorUserEmail}
          </p>
        </div>
        <form action={vendorLogout}>
          <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>Sign out</button>
        </form>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 font-normal">PO number</th>
            <th className="py-2 font-normal">Amount</th>
            <th className="py-2 font-normal">Status</th>
            <th className="py-2 font-normal">Confirmed</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {pos.map((po) => (
            <tr key={po.id} className="border-b">
              <td className="py-2">{po.poNumber}</td>
              <td className="py-2">{po.totalAmount} {po.currency}</td>
              <td className="py-2">{po.status}</td>
              <td className="py-2 text-muted-foreground">
                {po.vendorConfirmedAt ? po.vendorConfirmedAt.toISOString().slice(0, 10) : "Not yet"}
              </td>
              <td className="py-2">
                <Link href={`/vendor-portal/po/${po.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                  View
                </Link>
              </td>
            </tr>
          ))}
          {pos.length === 0 && (
            <tr>
              <td colSpan={5} className="py-6 text-center text-muted-foreground">No purchase orders yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
