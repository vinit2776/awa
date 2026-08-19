import type { ExtractedDocumentMeta } from "@/db/documentExtraction";

/**
 * GST/tax breakdown as printed on the source document — informational
 * only. Never feeds totalEstimatedValue, which stays sum(qty × price)
 * across line items, same as before this existed.
 */
export function TaxBreakdownPanel({ meta }: { meta: ExtractedDocumentMeta }) {
  const hasTax = meta.subtotal || meta.taxBreakdown.length > 0 || meta.taxTotal || meta.grandTotal;
  if (!hasTax) return null;

  return (
    <div className="flex max-w-2xl flex-col gap-1.5 rounded-lg border p-3 text-sm">
      <h3 className="text-xs text-muted-foreground">Tax, as shown on the document</h3>
      <dl className="flex flex-col gap-1 text-sm">
        {meta.subtotal && (
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd>{meta.subtotal}</dd>
          </div>
        )}
        {meta.taxBreakdown.map((tax, i) => (
          <div key={i} className="flex justify-between">
            <dt className="text-muted-foreground">
              {tax.label}
              {tax.rate ? ` (${tax.rate}%)` : ""}
            </dt>
            <dd>{tax.amount}</dd>
          </div>
        ))}
        {meta.taxTotal && (
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Tax total</dt>
            <dd>{meta.taxTotal}</dd>
          </div>
        )}
        {meta.grandTotal && (
          <div className="flex justify-between border-t pt-1 font-medium">
            <dt>Grand total</dt>
            <dd>{meta.grandTotal}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
