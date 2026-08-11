import { redirect } from "next/navigation";
import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { resolveSignInTargets } from "@/db/signInLookup";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

async function chooseTenant(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "");
  const organizationId = String(formData.get("organizationId") ?? "");

  // Re-derives the match set from the email rather than trusting the
  // submitted organizationId alone — same defensive shape as the
  // vendor-portal chooser (src/app/vendor-portal/choose/actions.ts):
  // a tampered field shouldn't be able to sign in to an organization
  // this email was never actually registered under.
  const { tenants } = await resolveSignInTargets(email);
  const match = tenants.find((t) => t.organizationId === organizationId);
  if (!match) redirect("/");

  redirect(await getSignInUrl({ organizationId: match.organizationId, loginHint: email }));
}

/**
 * Only reached when the same email is pre-provisioned under more than
 * one tenant (users is unique on tenant_id+email, not email alone) —
 * one person working with several of this platform's customers. Rare,
 * but a sign-in has to resolve to exactly one WorkOS Organization.
 */
export default async function ChooseTenantPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams;
  if (!email) redirect("/");

  const { tenants } = await resolveSignInTargets(email);
  if (tenants.length === 0) redirect("/");
  if (tenants.length === 1) {
    redirect(await getSignInUrl({ organizationId: tenants[0].organizationId, loginHint: email }));
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4">
      <div className="w-full max-w-sm rounded-lg border p-6">
        <h1 className="text-lg font-medium">Which company?</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {email} is registered with more than one company on this platform. Pick which one to sign in to.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          {tenants.map((t) => (
            <form key={t.tenantId} action={chooseTenant}>
              <input type="hidden" name="email" value={email} />
              <input type="hidden" name="organizationId" value={t.organizationId} />
              <button type="submit" className={cn(buttonVariants({ variant: "outline" }), "w-full")}>
                {t.tenantName}
              </button>
            </form>
          ))}
        </div>
      </div>
    </div>
  );
}
