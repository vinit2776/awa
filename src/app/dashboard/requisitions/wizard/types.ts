import type { LineInput } from "../actions";

export type Department = { id: string; name: string };
export type CostCenter = { id: string; name: string; annualBudget: string | null };
export type Category = { id: string; name: string };
export type CatalogItem = { id: string; name: string; categoryId: string | null; uom: string };

export type Line = LineInput & {
  key: string;
  // Client-side only, never sent to a server action — whether this line
  // came from document extraction. Drives LineItemsTable's item-cell
  // presentation (collapsed text input vs. the full catalog picker),
  // not treated as a "typing" signal so the two never flip mid-keystroke.
  fromExtraction?: boolean;
};

export const emptyLine = (): Line => ({
  key: crypto.randomUUID(),
  catalogItemId: null,
  freeTextDescription: null,
  categoryId: null,
  fulfillmentType: "goods",
  quantity: "1",
  uom: "each",
  estimatedUnitPrice: "0",
  priceConfirmed: false,
});

/** A line the extractor matched, by meaning, against one already on the form. */
export type PendingMatch = {
  id: string;
  extracted: Line;
  existingKey: string;
  existingDescription: string;
};

/**
 * Builds the (index, description) list sent to the extractor as matching
 * context, alongside the same entries' Line.key so a returned
 * matchesExistingLineIndex can be resolved back to a real line without
 * re-deriving the filter a second time. Only lines with a real
 * description count — an untouched blank row isn't "already entered".
 */
export function buildExistingLineRefs(
  lines: Line[],
  catalogItems: { id: string; name: string }[],
): { index: number; description: string; key: string }[] {
  const described = lines.map((l) => {
    if (l.catalogItemId) return catalogItems.find((i) => i.id === l.catalogItemId)?.name ?? null;
    return l.freeTextDescription?.trim() || null;
  });
  const refs: { index: number; description: string; key: string }[] = [];
  described.forEach((description, i) => {
    if (description) refs.push({ index: refs.length, description, key: lines[i].key });
  });
  return refs;
}
