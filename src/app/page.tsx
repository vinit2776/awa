import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default async function Home() {
  const signInUrl = await getSignInUrl();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4">
      <h1 className="text-xl font-medium">Procurement &amp; asset platform</h1>
      <a href={signInUrl} className={cn(buttonVariants())}>
        Sign in
      </a>
    </div>
  );
}
