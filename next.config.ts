import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // Default is 1MB; requisition document uploads (scanned quotations,
  // GST invoices) need more headroom. Matches MAX_UPLOAD_BYTES in
  // db/documentStorage.ts.
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
