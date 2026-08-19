"use client";

import { useEffect, useState } from "react";
import { getRequisitionDocumentPreviewUrl } from "../actions";

const REFRESH_MS = 4 * 60_000; // the signed URL is good for 300s — refresh with margin

/**
 * Renders the uploaded source document inline so the person filling in
 * line items can check them against the original without a second tab.
 * `initialUrl`, when the caller already has a server-computed signed URL
 * (an already-persisted document), skips the first client round-trip;
 * the refresh loop still runs off `sourceKey` either way, since staying
 * on this step through a full mapping-confirmation pass can outlast a
 * single 300s URL.
 */
export function DocumentPreview({ sourceKey, initialUrl }: { sourceKey: string; initialUrl?: string }) {
  const [url, setUrl] = useState<string | null>(initialUrl ?? null);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      getRequisitionDocumentPreviewUrl({ key: sourceKey }).then((r) => {
        if (!cancelled && r.url) setUrl(r.url);
      });
    };
    if (!initialUrl) refresh();
    const interval = setInterval(refresh, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialUrl only matters on mount
  }, [sourceKey]);

  if (!url) return null;
  const isPdf = sourceKey.toLowerCase().endsWith(".pdf");

  return (
    <div className="flex max-w-2xl flex-col gap-1">
      <h3 className="text-xs text-muted-foreground">Document preview</h3>
      {isPdf ? (
        <iframe src={url} className="h-[500px] w-full rounded-md border" title="Uploaded document" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- signed R2 URL, not a static/optimizable asset
        <img src={url} alt="Uploaded document" className="max-h-[500px] w-full rounded-md border object-contain" />
      )}
    </div>
  );
}
