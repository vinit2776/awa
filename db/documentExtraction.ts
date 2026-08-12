export type ExtractedLine = {
  description: string;
  quantity: string;
  uom: string;
  estimatedUnitPrice: string;
};

export type ExtractionResult = {
  lines: ExtractedLine[];
  vendorName: string | null;
  error?: string;
};

/**
 * Pulls line items (and, where available, the vendor name) out of an
 * uploaded quotation, proforma, or GST invoice. This is the one seam to
 * fill in once an extraction provider and API key are chosen — nothing
 * else in the upload flow (db/documentStorage.ts, the requisition form)
 * needs to change. Until then it fails clearly rather than silently, so
 * the rest of the feature ships in an honest, working state: manual
 * entry is always available regardless of whether this is configured.
 *
 * Expected shape once wired up: send `fileBytes`/`mimeType` to the
 * provider with a structured-extraction prompt or invoice-parsing
 * endpoint, map its response into ExtractedLine[], and return
 * `{ lines, vendorName }`. Bubble the provider's own failure (bad scan,
 * unsupported layout, rate limit) into `error` rather than throwing —
 * callers treat a returned `error` the same as "nothing extracted,
 * user fills it in by hand," which is the fallback this feature
 * explicitly needs to keep working either way.
 */
export async function extractLineItemsFromDocument(
  // Accepted now, unused until a provider is wired up, so the call site
  // in the upload action doesn't need to change when this does.
  file: { bytes: Uint8Array; mimeType: string },
): Promise<ExtractionResult> {
  void file;
  return {
    lines: [],
    vendorName: null,
    error: "Document extraction isn't configured yet — enter the line items manually below.",
  };
}
