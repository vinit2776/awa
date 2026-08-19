import type { ExtractedDocumentMeta } from "@/db/documentExtraction";
import { Badge } from "@/components/ui/badge";

const DOCUMENT_TYPE_LABEL: Record<ExtractedDocumentMeta["documentType"], string> = {
  quotation: "Quotation",
  proforma_invoice: "Proforma invoice",
  gst_invoice: "GST invoice",
  other: "Document",
};

/** Vendor and document identity read off an uploaded quotation/proforma/GST invoice — display-only. */
export function DocumentDetailsPanel({ meta }: { meta: ExtractedDocumentMeta }) {
  const hasVendorDetail = meta.vendorName || meta.vendorAddress || meta.vendorGstin || meta.vendorPan || meta.vendorCin;
  const hasDocumentDetail = meta.documentNumber || meta.documentDate;
  if (!hasVendorDetail && !hasDocumentDetail) return null;

  return (
    <div className="flex max-w-2xl flex-col gap-2 rounded-lg border p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{meta.vendorName ?? "Vendor"}</span>
        <Badge variant="info">{DOCUMENT_TYPE_LABEL[meta.documentType]}</Badge>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {meta.vendorAddress && (
          <>
            <dt>Address</dt>
            <dd>{meta.vendorAddress}</dd>
          </>
        )}
        {meta.vendorGstin && (
          <>
            <dt>GSTIN</dt>
            <dd>{meta.vendorGstin}</dd>
          </>
        )}
        {meta.vendorPan && (
          <>
            <dt>PAN</dt>
            <dd>{meta.vendorPan}</dd>
          </>
        )}
        {meta.vendorCin && (
          <>
            <dt>CIN</dt>
            <dd>{meta.vendorCin}</dd>
          </>
        )}
        {meta.documentNumber && (
          <>
            <dt>Document no.</dt>
            <dd>{meta.documentNumber}</dd>
          </>
        )}
        {meta.documentDate && (
          <>
            <dt>Date</dt>
            <dd>{meta.documentDate}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
