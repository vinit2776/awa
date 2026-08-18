/**
 * What a requisition is *for*, in a few words.
 *
 * Requisitions have no number and no title — the schema gives them a
 * requestor, a value, a department and some lines. So every screen that
 * had to name one reached for the value, and "600.00 INR" is useless for
 * finding anything: it isn't unique, it isn't memorable, and it doesn't
 * say what was asked for. The lines are the only human-meaningful
 * identifier available, so this builds a label from them.
 *
 * Deliberately short. This goes in a link, a list row and a heading, so
 * it has to survive being read at a glance next to fifteen others.
 */

type LineLike = { catalogItemId: string | null; freeTextDescription: string | null };
type CatalogItemLike = { id: string; name: string };

/** The name of one line, preferring what the requester actually typed over the catalogue's wording. */
function lineName(line: LineLike, catalogItems: CatalogItemLike[]): string | null {
  const freeText = line.freeTextDescription?.trim();
  if (freeText) return freeText;
  return catalogItems.find((i) => i.id === line.catalogItemId)?.name ?? null;
}

/**
 * "Laptop — 14in business" for one line, "Laptop — 14in business +2 more"
 * for three. Returns null when there is nothing to go on, so callers can
 * decide their own fallback rather than being handed a fake label.
 */
export function describeRequisition(
  lines: LineLike[],
  catalogItems: CatalogItemLike[],
  options: { prefer?: string } = {},
): string | null {
  const named = lines.map((l) => lineName(l, catalogItems)).filter((n): n is string => n !== null);
  if (named.length === 0) return null;

  // `prefer` leads with the line that matched a search. Without it a
  // three-line requisition found by its third line displays the first,
  // and the result looks like a mistake — you searched "helmet" and got
  // back "Ball valve 2 inch". Array.sort is stable, so everything else
  // keeps its original order.
  const prefer = options.prefer?.trim().toLowerCase();
  const ordered = prefer
    ? [...named].sort(
        (a, b) => Number(b.toLowerCase().includes(prefer)) - Number(a.toLowerCase().includes(prefer)),
      )
    : named;

  const [first, ...rest] = ordered;
  return rest.length > 0 ? `${first} +${rest.length} more` : first;
}

/**
 * describeRequisition() with the usual fallback.
 *
 * Deliberately not "Untitled — 150.00 INR": every caller already prints
 * the value on the adjacent line, so folding it into the label both
 * repeats it and reads badly once the caller adds its own prefix
 * ("Unsubmitted draft — Untitled — 150.00 INR").
 */
export function requisitionLabel(
  lines: LineLike[],
  catalogItems: CatalogItemLike[],
  options: { prefer?: string } = {},
): string {
  return describeRequisition(lines, catalogItems, options) ?? "Untitled";
}
