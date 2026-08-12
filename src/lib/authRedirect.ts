import { getSignInUrl, getSignUpUrl } from "@workos-inc/authkit-nextjs";
import type { SignInTarget } from "@/db/signInLookup";

// A target with no workosUserId has never completed a WorkOS callback
// (db/tenant.ts#linkUserOnSignIn only sets it on first success) — sending
// them through getSignInUrl() shows WorkOS's returning-user screen, which
// asks for a password they've never had a chance to set. Sign-up is the
// screen that actually lets them create one.
export async function getSignUrlForTarget(target: SignInTarget, email: string): Promise<string> {
  const opts = { organizationId: target.organizationId, loginHint: email };
  return target.workosUserId ? getSignInUrl(opts) : getSignUpUrl(opts);
}
