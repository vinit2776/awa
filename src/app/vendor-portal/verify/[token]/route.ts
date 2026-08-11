import { NextResponse } from "next/server";
import { activateVendorUserIfInvited, findVendorLoginMatches, verifyMagicLinkToken } from "@/db/vendorAuth";
import { setVendorSessionCookie } from "@/db/vendorSession";

/**
 * GET, not a server action — this is the link clicked from an email, so
 * it has to be a plain navigable URL. Redirects rather than rendering
 * directly so the resulting page always comes from a normal page
 * request (consistent back button, no resubmission-on-refresh).
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const email = verifyMagicLinkToken(token);
  const origin = new URL(request.url).origin;

  if (!email) {
    return NextResponse.redirect(`${origin}/vendor-portal/login?error=expired`);
  }

  const matches = await findVendorLoginMatches(email);
  if (matches.length === 0) {
    return NextResponse.redirect(`${origin}/vendor-portal/login?error=expired`);
  }

  if (matches.length > 1) {
    // The same magic-link token doubles as the chooser's own credential —
    // it's still within its 15-minute window and already proves control
    // of this email, no reason to mint a second token type for it.
    return NextResponse.redirect(`${origin}/vendor-portal/choose?token=${encodeURIComponent(token)}`);
  }

  await activateVendorUserIfInvited(matches[0].vendorUserId);
  await setVendorSessionCookie(matches[0].vendorUserId);
  return NextResponse.redirect(`${origin}/vendor-portal`);
}
