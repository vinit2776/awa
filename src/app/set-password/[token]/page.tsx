import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { adminDb } from "@/db/adminClient";
import { users } from "@/db/schema";
import { hashPassword, makeUserSessionToken, verifyUserSetPasswordToken } from "@/db/userAuth";
import { setAppSessionCookie } from "@/db/userSession";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

async function submitPassword(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  const userId = verifyUserSetPasswordToken(token);
  if (!userId) redirect("/set-password/invalid");

  if (password.length < 8) {
    redirect(`/set-password/${encodeURIComponent(token)}?error=${encodeURIComponent("Password must be at least 8 characters.")}`);
  }
  if (password !== confirm) {
    redirect(`/set-password/${encodeURIComponent(token)}?error=${encodeURIComponent("Passwords don't match.")}`);
  }

  const passwordHash = await hashPassword(password);
  const [updated] = await adminDb
    .update(users)
    .set({ passwordHash, status: "active", updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  if (!updated) redirect("/set-password/invalid");

  await setAppSessionCookie(makeUserSessionToken(updated.id));
  redirect("/dashboard");
}

export default async function SetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;

  const userId = verifyUserSetPasswordToken(token);
  if (!userId) redirect("/set-password/invalid");

  const [row] = await adminDb.select({ email: users.email, fullName: users.fullName }).from(users).where(eq(users.id, userId));
  if (!row) redirect("/set-password/invalid");

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4">
      <div className="w-full max-w-sm rounded-lg border p-6">
        <h1 className="text-lg font-medium">Set your password</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {row.fullName} &middot; {row.email}
        </p>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        <form action={submitPassword} className="mt-4 flex flex-col gap-2">
          <input type="hidden" name="token" value={token} />
          <input
            name="password"
            type="password"
            required
            minLength={8}
            placeholder="New password (min. 8 characters)"
            className="h-9 rounded-md border px-2 text-sm"
          />
          <input
            name="confirm"
            type="password"
            required
            minLength={8}
            placeholder="Confirm password"
            className="h-9 rounded-md border px-2 text-sm"
          />
          <button type="submit" className={cn(buttonVariants())}>
            Set password &amp; sign in
          </button>
        </form>
      </div>
    </div>
  );
}
