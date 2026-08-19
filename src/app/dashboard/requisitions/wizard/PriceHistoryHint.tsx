"use client";

import { useEffect, useState } from "react";
import { formatRelative } from "@/app/dashboard/support/ui";
import { getCatalogItemPriceHistory } from "../actions";
import type { ItemPurchaseHistoryEntry } from "@/db/itemHistory";

/**
 * "Last paid ₹X, N days ago, from Vendor Y" — the same purchase-history
 * lookup already shown to approvers (src/app/dashboard/approvals/page.tsx),
 * surfaced here instead so a requester has something to anchor an estimate
 * to before anyone else ever sees it. "Use this" is a plain click, not an
 * auto-fill — never overwrites something mid-typed.
 */
export function PriceHistoryHint({
  catalogItemId,
  currentPrice,
  onUsePrice,
}: {
  catalogItemId: string | null;
  currentPrice: string;
  onUsePrice: (price: string) => void;
}) {
  const [history, setHistory] = useState<ItemPurchaseHistoryEntry[] | null>(null);

  useEffect(() => {
    if (!catalogItemId) return;
    let cancelled = false;
    getCatalogItemPriceHistory({ catalogItemId }).then((rows) => {
      if (!cancelled) setHistory(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [catalogItemId]);

  if (!catalogItemId || !history || history.length === 0) return null;

  const last = history[0];
  const previous = Number(last.unitPrice);
  const now = Number(currentPrice);
  // A zero/empty current price isn't a "100% lower" price — it's "no answer yet".
  // Comparing against it produces a meaningless variance, so we suppress the
  // variance clause (not the whole hint) until the user has typed a real,
  // positive number. Don't reinstate a comparison against 0 here.
  const hasEnteredPrice = now > 0 && Number.isFinite(now);
  const pct = previous && Number.isFinite(previous) && hasEnteredPrice ? ((now - previous) / previous) * 100 : null;
  const variance = pct !== null && Math.abs(pct) >= 1 ? pct : null;

  return (
    <p className="mt-1 text-xs text-muted-foreground">
      Last paid {last.unitPrice} ({last.vendorName}, {formatRelative(last.date)})
      {variance !== null && (
        <span className={variance > 0 ? "text-amber-600" : "text-emerald-600"}>
          {" "}
          — {Math.abs(variance).toFixed(1)}% {variance > 0 ? "higher" : "lower"}
        </span>
      )}
      {" · "}
      <button
        type="button"
        onClick={() => onUsePrice(last.unitPrice)}
        className="underline underline-offset-2 hover:text-foreground"
      >
        Use this
      </button>
    </p>
  );
}
