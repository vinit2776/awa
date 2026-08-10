import { handleAuth } from "@workos-inc/authkit-nextjs";
import { linkUserOnSignIn } from "@/db/tenant";

// A TenantLinkError here (tenant not linked to this org yet, or this email
// wasn't pre-provisioned) is left to propagate and surface as a real
// error page — an admin step is missing, that's not something to hide
// behind a silent redirect.
export const GET = handleAuth({
  returnPathname: "/dashboard",
  onSuccess: async ({ user, organizationId }) => {
    await linkUserOnSignIn({
      workosUserId: user.id,
      workosOrganizationId: organizationId,
      email: user.email,
    });
  },
});
