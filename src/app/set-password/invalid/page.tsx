import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function InvalidSetPasswordLink() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <h1 className="text-xl font-medium">This link has expired</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Set-password links are valid for 24 hours. Ask your admin to generate a new one from the Users page.
      </p>
      <Link href="/" className={cn(buttonVariants({ variant: "outline" }))}>
        Back to sign in
      </Link>
    </div>
  );
}
