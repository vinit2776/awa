import { redirect } from "next/navigation";
import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { resolveSignInTargets } from "@/db/signInLookup";
import { getSignUrlForTarget } from "@/lib/authRedirect";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// getSignInUrl() sets a cookie internally (PKCE state) — Next.js only
// allows cookie writes inside a Server Action or Route Handler, not a
// plain Server Component render. Computing it at page-render time threw
// a 500 on every load; this defers the call to the form submit.
//
// Needs the email up front — not just a bare "Sign in" button — to
// resolve which WorkOS Organization (tenant) to scope the session to
// before calling getSignInUrl(). Without an explicit organizationId,
// WorkOS has no way to know which of this app's many tenant
// organizations a signing-in email belongs to, and the callback fails
// with "This WorkOS session has no organization."
async function handleSignIn(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  if (!email) redirect(`/?error=${encodeURIComponent("Enter your email to sign in.")}`);

  const { isPlatformAdmin, tenants } = await resolveSignInTargets(email);

  if (isPlatformAdmin) {
    redirect(await getSignInUrl({ loginHint: email }));
  }

  if (tenants.length === 0) {
    redirect(`/?error=${encodeURIComponent("No account found for that email. Ask your admin to invite you first.")}`);
  }

  if (tenants.length === 1) {
    redirect(await getSignUrlForTarget(tenants[0], email));
  }

  redirect(`/choose-tenant?email=${encodeURIComponent(email)}`);
}

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4">
      <h1 className="text-xl font-medium">Procurement &amp; asset platform</h1>
      {error && <p className="max-w-sm text-center text-sm text-destructive">{error}</p>}
      <form action={handleSignIn} className="flex flex-col gap-2">
        <input
          name="email"
          type="email"
          required
          placeholder="you@company.com"
          className="h-9 w-64 rounded-md border px-2 text-sm"
        />
        <button type="submit" className={cn(buttonVariants())}>
          Sign in
        </button>
      </form>
    </div>
  );
}
