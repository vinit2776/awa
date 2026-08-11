import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { requestVendorMagicLink } from "./actions";

export default async function VendorLoginPage({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const { sent } = await searchParams;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <div className="w-full max-w-sm rounded-lg border p-6">
        <h1 className="text-lg font-medium">Vendor portal</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sign in with the email address a buyer added you with — we&apos;ll send a one-time sign-in link.
        </p>

        {sent ? (
          <p className="mt-4 text-sm">
            If that email is on file, a sign-in link is on its way. It expires in 15 minutes.
          </p>
        ) : (
          <form action={requestVendorMagicLink} className="mt-4 flex flex-col gap-2">
            <input
              name="email"
              type="email"
              required
              placeholder="you@company.com"
              className="h-9 rounded-md border px-2 text-sm"
            />
            <button type="submit" className={cn(buttonVariants())}>Send sign-in link</button>
          </form>
        )}
      </div>
    </div>
  );
}
