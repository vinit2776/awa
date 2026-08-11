import { authkitProxy } from "@workos-inc/authkit-nextjs";

export default authkitProxy({
  middlewareAuth: {
    enabled: true,
    // Paths a signed-out visitor can hit without being redirected to sign in.
    // /po-verify is the public QR-scan verification page (§05) — a vendor
    // scanning a PO's QR code has no session and should never need one.
    // /offline is the service worker's offline fallback (S14) — it has to
    // be reachable regardless of auth state, since sw.js precaches it on
    // install and there's no way to know a visitor's session state ahead
    // of that fetch.
    unauthenticatedPaths: ["/", "/callback", "/po-verify/:path*", "/offline"],
  },
});

export const config = {
  // sw.js, manifest.webmanifest, and icon.svg (public/) must never hit
  // the auth middleware at all — a browser fetching the service worker
  // script or the web manifest has no session yet by definition (that's
  // the whole point of a PWA install prompt or an offline-first SW
  // registration), and a redirect response instead of the real file
  // makes the service worker registration fail outright, for every
  // visitor, authenticated or not — not just a page that renders wrong.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icon.svg).*)"],
};
