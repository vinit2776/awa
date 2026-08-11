import { redirect } from "next/navigation";
import { findVendorLoginMatches, verifyMagicLinkToken } from "@/db/vendorAuth";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { chooseVendorAccount } from "./actions";

/**
 * Only reached when the same email has a vendor_users row under more
 * than one tenant (vendor_users is unique on tenant_id+vendor_id+email,
 * not email alone) — one vendor company doing business with several of
 * this platform's customers. Rare, but the portal has to resolve to
 * exactly one (tenant, vendor) session, so this is unavoidable.
 */
export default async function VendorChoosePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) redirect("/vendor-portal/login");

  const email = verifyMagicLinkToken(token);
  if (!email) redirect("/vendor-portal/login?error=expired");

  const matches = await findVendorLoginMatches(email);
  if (matches.length === 0) redirect("/vendor-portal/login?error=expired");

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <div className="w-full max-w-sm rounded-lg border p-6">
        <h1 className="text-lg font-medium">Which company?</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {email} is registered as a vendor contact with more than one company. Pick which one to view.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          {matches.map((m) => (
            <form key={m.vendorUserId} action={chooseVendorAccount}>
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="vendorUserId" value={m.vendorUserId} />
              <button type="submit" className={cn(buttonVariants({ variant: "outline" }), "w-full justify-between")}>
                <span>{m.tenantName}</span>
                <span className="text-muted-foreground">{m.vendorName}</span>
              </button>
            </form>
          ))}
        </div>
      </div>
    </div>
  );
}
