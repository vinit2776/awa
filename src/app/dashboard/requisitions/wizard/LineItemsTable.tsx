"use client";

import { useMemo, useState } from "react";
import { Term } from "@/components/ui/help";
import { SearchableSelect } from "@/components/ui/combobox";
import { PriceHistoryHint } from "./PriceHistoryHint";
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
  // A dozen-plus catalog items is already too many to scan in a closed
  // dropdown — searchable beats a scrollable native <select> here.
  const catalogOptions = useMemo(() => catalogItems.map((i) => ({ value: i.id, label: i.name })), [catalogItems]);

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-xs text-muted-foreground">
          <th className="py-2 font-normal">Item</th>
          <th className="py-2 font-normal">Category</th>
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
          return (
            <tr key={line.key} className="border-b align-top">
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
                  value={line.categoryId ?? ""}
                  onChange={(e) => updateLine(line.key, { categoryId: e.target.value || null })}
                  className="h-8 w-32 rounded-md border px-2 text-sm"
                >
                  <option value="">—</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
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
                <PriceHistoryHint
                  catalogItemId={line.catalogItemId}
                  currentPrice={line.estimatedUnitPrice}
                  onUsePrice={(price) => updateLine(line.key, { estimatedUnitPrice: price, priceConfirmed: false })}
                />
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
          );
        })}
      </tbody>
    </table>
  );
}
