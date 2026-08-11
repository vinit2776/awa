import { handleAuth } from "@workos-inc/authkit-nextjs";
import { NextResponse } from "next/server";
import { isPlatformAdminEmail } from "@/db/platformAdmins";
import { linkUserOnSignIn, TenantLinkError } from "@/db/tenant";

// A TenantLinkError here (tenant not linked to this org yet, or this email
// wasn't pre-provisioned) is an admin step being missing, not something to
// hide behind a silent redirect — onError below surfaces its message
// instead of AuthKit's generic "contact your organization admin" fallback,
// which otherwise swallows it regardless of onSuccess throwing.
//
// Redirects back to "/" with ?error= rather than returning AuthKit's
// default JSON body (Something went wrong / description) directly: this
// is a full-page browser navigation mid-sign-in, not an API call, and "/"
// is the only unauthenticated page there is to land on — same ?error=
// query-param-plus-redirect pattern used everywhere else in this app
// (vendor-portal login, admin/users invite, etc.), not a one-off.
export const GET = handleAuth({
  returnPathname: "/dashboard",
  onSuccess: async ({ user, organizationId }) => {
    // A platform admin isn't a tenant user at all — nothing to link.
    // Without this check every platform-admin sign-in hit
    // linkUserOnSignIn unconditionally and threw a TenantLinkError
    // (no organization, or no tenant/users row for them), meaning the
    // platform console's own sign-in path had never actually worked.
    if (await isPlatformAdminEmail(user.email)) return;

    await linkUserOnSignIn({
      workosUserId: user.id,
      workosOrganizationId: organizationId,
      email: user.email,
    });
  },
  onError: async ({ error, request }) => {
    const description =
      error instanceof TenantLinkError
        ? error.message
        : "Couldn't sign in. If you are not sure what happened, please contact your organization admin.";
    const url = new URL("/", request.url);
    url.searchParams.set("error", description);
    return NextResponse.redirect(url);
  },
});
