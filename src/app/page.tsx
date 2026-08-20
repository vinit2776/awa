import { redirect } from "next/navigation";
import { authenticateUser, makeTenantChoiceToken, makeUserSessionToken } from "@/db/userAuth";
import { setAppSessionCookie } from "@/db/userSession";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

async function handleSignIn(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    redirect(`/?error=${encodeURIComponent("Enter your email and password.")}`);
  }

  const matches = await authenticateUser(email, password);
  if (matches.length === 0) {
    // Generic message on purpose — "no account" vs "wrong password" would
    // let this form be used to enumerate which emails are provisioned.
    redirect(`/?error=${encodeURIComponent("Invalid email or password.")}`);
  }

  if (matches.length > 1) {
    // The password itself never goes in the URL — this token just proves
    // "these userIds already passed a password check", not the password.
    const token = makeTenantChoiceToken(matches.map((m) => m.userId));
    redirect(`/choose-tenant?token=${encodeURIComponent(token)}`);
  }

  await setAppSessionCookie(makeUserSessionToken(matches[0].userId));
  redirect("/dashboard");
}

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4">
      <h1 className="text-xl font-medium">Procurement &amp; asset platform</h1>
      {error && <p className="max-w-sm text-center text-sm text-destructive">{error}</p>}
      <form action={handleSignIn} className="flex w-full max-w-64 flex-col gap-2">
        <input
          name="email"
          type="email"
          required
          placeholder="you@company.com"
          className="h-11 w-full rounded-md border px-2 text-base sm:h-9 sm:text-sm"
        />
        <input
          name="password"
          type="password"
          required
          placeholder="Password"
          className="h-11 w-full rounded-md border px-2 text-base sm:h-9 sm:text-sm"
        />
        <button type="submit" className={cn(buttonVariants(), "h-11 sm:h-8")}>
          Sign in
        </button>
      </form>
    </div>
  );
}
