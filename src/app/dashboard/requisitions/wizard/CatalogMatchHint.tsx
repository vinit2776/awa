"use client";

import { useEffect, useRef, useState } from "react";
import { suggestCatalogItemForLine } from "../actions";
import type { SimilarCatalogItem } from "@/db/catalogMatch";

/**
 * Free-text requisition lines carry no catalogue identity — two people
 * typing "SKF 6205 bearing" and picking "Bearing, SKF 6205" from the
 * catalogue are invisible to each other, which blocks anything that needs
 * to know two lines mean the same physical item (duplicate detection,
 * "already on order" warnings). This is the gentle nudge at the point of
 * entry, before that gap accumulates. It only ever proposes;
 * MatchSuggestionRow established the "same judgment call, different data
 * source" framing this mirrors, and accepting never happens without a
 * click, matching PriceHistoryHint's "Use this" pattern.
 *
 * Looked up on blur, not while typing: suggestCatalogItemForLine now costs
 * an LLM call (db/catalogMatchJudge.ts) once trigram recall finds
 * candidates, so a per-keystroke debounce would mean a paid API call for
 * every pause in typing, not just when someone's actually done. The
 * `checkSignal` prop is what "done typing" is communicated as — the
 * parent (LineItemsTable) bumps it from the description input's onBlur,
 * since this component doesn't own that input in either of the two
 * presentations it's rendered under (the full picker's free-text field,
 * and the collapsed extraction-sourced field).
 *
 * Dismissal ("it's different") is remembered on the line itself
 * (Line.catalogMatchDismissed), not in this component's own state,
 * because "is this the catalogue's SKF 6205?" is a fact about the line,
 * not about a particular render of this component. Lines get added,
 * removed and reordered independently of it, so the answer needs to
 * travel with the line's own data rather than live somewhere it could be
 * left behind.
 */
export function CatalogMatchHint({
  description,
  catalogItemId,
  dismissed,
  checkSignal,
  onDismiss,
  onAccept,
}: {
  description: string | null;
  catalogItemId: string | null;
  dismissed: boolean | undefined;
  // Bumped by the parent on the description input's onBlur — the only
  // thing that should trigger a lookup. Deliberately not `description`
  // itself: see the effect below.
  checkSignal: number;
  onDismiss: () => void;
  onAccept: (item: SimilarCatalogItem) => void;
}) {
  // Tagging the fetched match with the description it was fetched for
  // (rather than clearing state to null whenever the line stops being
  // eligible) lets render time decide whether a stale result is still
  // valid, instead of an effect reaching for setState just to invalidate it.
  const [fetched, setFetched] = useState<{ forDescription: string; result: SimilarCatalogItem | null } | null>(null);
  const requestId = useRef(0);

  const trimmed = (description ?? "").trim();
  const eligible = !catalogItemId && !dismissed && trimmed.length >= 3;

  useEffect(() => {
    // Only checkSignal in the dependency array, deliberately: this must
    // fire once per blur, not once per keystroke. `eligible` and
    // `trimmed` are read from the closure at whatever render last ran
    // before the signal changed — by the time onBlur increments the
    // signal, the description state it reads has already been committed
    // and re-rendered, so the closure sees the final typed value, not a
    // stale one.
    //
    // A blur on its own isn't reason enough to look up again — tabbing
    // back through an already-finished form blurs every field without
    // changing anything, and each lookup is now a billable API call. The
    // trigger that actually matters is "this description hasn't been
    // judged yet", which `fetched?.forDescription === trimmed` already
    // tells us: skip when the last fetch (if any) was for the exact same
    // text. An edit between two blurs changes `trimmed`, so it still
    // re-queries — only a truly unchanged description short-circuits.
    if (checkSignal === 0 || !eligible || fetched?.forDescription === trimmed) return;

    const thisRequest = ++requestId.current;
    suggestCatalogItemForLine(trimmed).then((result) => {
      // A slower, earlier lookup resolving after a newer one would
      // otherwise clobber the newer (or null, i.e. "no match") result —
      // only the most recently *issued* request is allowed to write to
      // state, same guard PriceHistoryHint uses via its `cancelled` flag,
      // just keyed on ordering since successive blurs can overlap in flight.
      if (thisRequest === requestId.current) setFetched({ forDescription: trimmed, result });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkSignal]);

  const match = eligible && fetched?.forDescription === trimmed ? fetched.result : null;
  if (!match) return null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1 rounded-md border border-primary/25 bg-primary/6 px-2 py-1.5 text-xs">
      <p>
        Is this <span className="font-medium">&ldquo;{match.name}&rdquo;</span> from the catalogue?
      </p>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={() => onAccept(match)}
          className="underline underline-offset-2 hover:text-foreground"
        >
          Yes, use it
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          It&rsquo;s different
        </button>
      </div>
    </div>
  );
}
