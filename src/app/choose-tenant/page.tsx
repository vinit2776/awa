import { eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { adminDb } from "@/db/adminClient";
import { tenants as tenantsTable, users as usersTable } from "@/db/schema";
import { makeUserSessionToken, verifyTenantChoiceToken } from "@/db/userAuth";
import { setAppSessionCookie } from "@/db/userSession";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

async function candidatesFor(token: string) {
  const userIds = verifyTenantChoiceToken(token);
  if (!userIds || userIds.length === 0) return [];
  return adminDb
    .select({ userId: usersTable.id, tenantName: tenantsTable.name })
    .from(usersTable)
    .innerJoin(tenantsTable, eq(usersTable.tenantId, tenantsTable.id))
    .where(inArray(usersTable.id, userIds));
}

async function chooseTenant(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "");
  const userId = String(formData.get("userId") ?? "");

  // Re-derives the candidate set from the token rather than trusting the
  // submitted userId alone — a tampered field shouldn't be able to sign
  // in as a user this token never actually proved a password match for.
  const candidates = await candidatesFor(token);
  const match = candidates.find((c) => c.userId === userId);
  if (!match) redirect("/?error=" + encodeURIComponent("That choice expired — sign in again."));

  await setAppSessionCookie(makeUserSessionToken(match.userId));
  redirect("/dashboard");
}

/**
 * Only reached when the same email is pre-provisioned under more than one
 * tenant with the same password (users is unique on tenant_id+email, not
 * email alone) — one person working with several of this platform's
 * customers. Rare, but a sign-in has to resolve to exactly one account.
 */
export default async function ChooseTenantPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) redirect("/");

  const candidates = await candidatesFor(token);
  if (candidates.length === 0) redirect("/?error=" + encodeURIComponent("That choice expired — sign in again."));
  if (candidates.length === 1) {
    await setAppSessionCookie(makeUserSessionToken(candidates[0].userId));
    redirect("/dashboard");
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4">
      <div className="w-full max-w-sm rounded-lg border p-6">
        <h1 className="text-lg font-medium">Which company?</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your email is registered with more than one company on this platform. Pick which one to sign in to.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          {candidates.map((c) => (
            <form key={c.userId} action={chooseTenant}>
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="userId" value={c.userId} />
              <button type="submit" className={cn(buttonVariants({ variant: "outline" }), "w-full")}>
                {c.tenantName}
              </button>
            </form>
          ))}
        </div>
      </div>
    </div>
  );
}
