import { authkitProxy } from "@workos-inc/authkit-nextjs";

export default authkitProxy({
  middlewareAuth: {
    enabled: true,
    // Paths a signed-out visitor can hit without being redirected to sign in.
    // /po-verify is the public QR-scan verification page (§05) — a vendor
    // scanning a PO's QR code has no session and should never need one.
    unauthenticatedPaths: ["/", "/callback", "/po-verify/:path*"],
  },
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
