import { redirect } from "next/navigation";
import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// getSignInUrl() sets a cookie internally (PKCE state) — Next.js only
// allows cookie writes inside a Server Action or Route Handler, not a
// plain Server Component render. Computing it at page-render time threw
// a 500 on every load; this defers the call to the button's click.
async function handleSignIn() {
  "use server";
  const signInUrl = await getSignInUrl();
  redirect(signInUrl);
}

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4">
      <h1 className="text-xl font-medium">Procurement &amp; asset platform</h1>
      <form action={handleSignIn}>
        <button type="submit" className={cn(buttonVariants())}>
          Sign in
        </button>
      </form>
    </div>
  );
}
