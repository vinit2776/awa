import type { MetadataRoute } from "next";

// Placeholder icon/branding (public/icon.svg) — not final design, just
// enough for the manifest to be valid and the app installable.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AWA Procurement & Asset Platform",
    short_name: "AWA",
    description: "Multi-tenant requisition-to-payment procurement platform.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#fcfcfb",
    theme_color: "#d97757",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
