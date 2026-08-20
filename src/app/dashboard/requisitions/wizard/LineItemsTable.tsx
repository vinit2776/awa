"use client";

import { Fragment, useMemo, useState } from "react";
import { Term, Info } from "@/components/ui/help";
import { SearchableSelect } from "@/components/ui/combobox";
import { PriceHistoryHint } from "./PriceHistoryHint";
import { CatalogMatchHint } from "./CatalogMatchHint";
import { CommitmentHint } from "./CommitmentHint";
import type { Line, Category, CatalogItem } from "./types";

export function LineItemsTable({
  lines,
  categories,
  catalogItems,
  updateLine,
  removeLine,
}: {
  lines: Line[];
  categories: Category[];
  catalogItems: CatalogItem[];
  updateLine: (key: string, patch: Partial<Line>) => void;
  removeLine: (key: string) => void;
}) {
  // Which extraction-sourced lines the user has asked to see the full
  // catalog picker for, despite the collapsed default — see Line.fromExtraction.
  const [pickerOpen, setPickerOpen] = useState<Set<string>>(new Set());
  // Which lines have their category control expanded. Category is
  // optional and only does anything once an admin sets up a rule scoped
  // to it (db/approvals.ts's lineCategoryIds matching) — asking it as a
  // full column on every line is friction with no payoff for a tenant
  // that never configures one, so it starts collapsed behind a toggle
  // in the hint row, same as "or pick from catalog" does for the item
  // picker. A line that already has one (set by hand, or auto-filled
  // from a catalog pick) shows the control expanded, not the toggle.
  const [categoryOpen, setCategoryOpen] = useState<Set<string>>(new Set());
  // A dozen-plus catalog items is already too many to scan in a closed
  // dropdown — searchable beats a scrollable native <select> here.
  const catalogOptions = useMemo(() => catalogItems.map((i) => ({ value: i.id, label: i.name })), [catalogItems]);
  // Bumped per line key on the description input's onBlur, to tell
  // CatalogMatchHint "the user finished typing, check now" — see that
  // component's docblock for why this is blur-triggered rather than
  // debounced-while-typing (the lookup now costs an LLM call).
  const [catalogCheckSignals, setCatalogCheckSignals] = useState<Record<string, number>>({});
  const triggerCatalogCheck = (key: string) =>
    setCatalogCheckSignals((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }));

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-xs text-muted-foreground">
          <th className="py-2 font-normal">Item</th>
          <th className="py-2 font-normal">Type</th>
          <th className="py-2 font-normal">Qty</th>
          <th className="py-2 font-normal">
            <Term name="uom">UoM</Term>
          </th>
          <th className="py-2 font-normal">Estimated price</th>
          <th className="py-2 font-normal">Line total</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => {
          const showPicker = !line.fromExtraction || pickerOpen.has(line.key);
          // Same field-population logic as SearchableSelect's onChange
          // below — accepting a suggestion is just "the user picked this
          // catalogue item", so it must leave the line in the identical
          // state a manual pick would, uom/categoryId/free-text clear included.
          const acceptCatalogMatch = (item: { id: string; uom: string; categoryId: string | null }) =>
            updateLine(line.key, {
              catalogItemId: item.id,
              freeTextDescription: null,
              uom: item.uom,
              categoryId: item.categoryId,
            });
          return (
            <Fragment key={line.key}>
              <tr className="align-top">
                <td className="py-2 pr-2">
                  {showPicker ? (
                    <>
                      <SearchableSelect
                        options={catalogOptions}
                        value={line.catalogItemId ?? ""}
                        onChange={(id) => {
                          const item = catalogItems.find((i) => i.id === id);
                          updateLine(line.key, {
                            catalogItemId: id || null,
                            freeTextDescription: id ? null : line.freeTextDescription,
                            uom: item?.uom ?? line.uom,
                            categoryId: item?.categoryId ?? line.categoryId,
                          });
                        }}
                        placeholder="Search catalog…"
                        emptyOptionLabel="— custom item —"
                        className="w-40"
                      />
                      {!line.catalogItemId && (
                        <input
                          value={line.freeTextDescription ?? ""}
                          onChange={(e) => updateLine(line.key, { freeTextDescription: e.target.value })}
                          onBlur={() => triggerCatalogCheck(line.key)}
                          placeholder="Describe the item"
                          className="mt-1 h-8 w-40 rounded-md border px-2 text-sm"
                        />
                      )}
                    </>
                  ) : (
                    <div className="flex flex-col items-start gap-0.5">
                      <input
                        value={line.freeTextDescription ?? ""}
                        onChange={(e) => updateLine(line.key, { freeTextDescription: e.target.value })}
                        onBlur={() => triggerCatalogCheck(line.key)}
                        className="h-8 w-40 rounded-md border px-2 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setPickerOpen((prev) => new Set(prev).add(line.key))}
                        className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      >
                        or pick from catalog
                      </button>
                    </div>
                  )}
                </td>
                <td className="py-2 pr-2">
                  <select
                    value={line.fulfillmentType}
                    onChange={(e) => updateLine(line.key, { fulfillmentType: e.target.value as "goods" | "service" })}
                    className="h-8 w-24 rounded-md border px-2 text-sm"
                  >
                    <option value="goods">Goods</option>
                    <option value="service">Service</option>
                  </select>
                </td>
                <td className="py-2 pr-2">
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    value={line.quantity}
                    onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                    className="h-8 w-20 rounded-md border px-2 text-sm"
                  />
                </td>
                <td className="py-2 pr-2">
                  <input
                    value={line.uom}
                    onChange={(e) => updateLine(line.key, { uom: e.target.value })}
                    className="h-8 w-16 rounded-md border px-2 text-sm"
                  />
                </td>
                <td className="py-2 pr-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={line.estimatedUnitPrice}
                    onChange={(e) => updateLine(line.key, { estimatedUnitPrice: e.target.value })}
                    placeholder="Exact price, or your ceiling"
                    className="h-8 w-28 rounded-md border px-2 text-sm"
                  />
                  <label className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={line.priceConfirmed}
                      onChange={(e) => updateLine(line.key, { priceConfirmed: e.target.checked })}
                      className="size-3.5"
                    />
                    Confirmed price
                  </label>
                </td>
                <td className="py-2 pr-2 text-sm">
                  {(Number(line.quantity || 0) * Number(line.estimatedUnitPrice || 0)).toFixed(2)}
                </td>
                <td className="py-2">
                  {lines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeLine(line.key)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
              {/* Hints — and the collapsed category toggle — live in a
                  full-width sub-row rather than their own cramped columns
                  above, so a wide hint doesn't stretch the column it refers
                  to. No vertical padding/border on the cell itself; the
                  border that used to sit on the main row moves down here so
                  the pair still reads as one bordered row. */}
              <tr className="border-b">
                <td colSpan={7} className="py-0">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 max-w-2xl">
                    <div className="text-xs">
                      {categoryOpen.has(line.key) || line.categoryId ? (
                        <label className="flex items-center gap-1.5 text-muted-foreground">
                          Category
                          <Info title="Category" next="Set it up under Admin › Approval rules.">
                            What kind of purchase this is, not what it&apos;s called — only used so an approval
                            rule can require a different approver for this kind of thing regardless of
                            department. It doesn&apos;t add anything to the catalogue and nobody else sees it
                            unless a rule is scoped to it.
                          </Info>
                          <select
                            value={line.categoryId ?? ""}
                            onChange={(e) => updateLine(line.key, { categoryId: e.target.value || null })}
                            className="h-6 rounded-md border px-1.5 text-xs"
                          >
                            <option value="">— none —</option>
                            {categories.map((c) => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setCategoryOpen((prev) => new Set(prev).add(line.key))}
                          className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                        >
                          + category
                        </button>
                      )}
                    </div>
                    <CatalogMatchHint
                      description={line.freeTextDescription}
                      catalogItemId={line.catalogItemId}
                      dismissed={line.catalogMatchDismissed}
                      checkSignal={catalogCheckSignals[line.key] ?? 0}
                      onDismiss={() => updateLine(line.key, { catalogMatchDismissed: true })}
                      onAccept={acceptCatalogMatch}
                    />
                    <CommitmentHint catalogItemId={line.catalogItemId} />
                    <PriceHistoryHint
                      catalogItemId={line.catalogItemId}
                      currentPrice={line.estimatedUnitPrice}
                      onUsePrice={(price) => updateLine(line.key, { estimatedUnitPrice: price, priceConfirmed: false })}
                    />
                  </div>
                </td>
              </tr>
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
