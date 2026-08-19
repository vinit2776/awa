"use client";

import { useEffect, useState } from "react";
import { getOpenCommitments } from "../actions";
import type { OpenCommitments, CommitmentsByUom } from "@/db/itemCommitments";

/**
 * "12 on order (PO-2026-0042, Kalyani Steels) · 5 more awaiting approval"
 * — surfaced at line entry so a requester sees what's already committed
 * for this item before adding to it. The single largest cause of
 * over-ordering per the S19 brief: a storekeeper with no visibility into
 * open POs or pending requisitions has no way to know 12 bearings are
 * already inbound before raising a line for 10 more. Informational only,
 * same as PriceHistoryHint and the budget bar — never blocks, just states
 * the consequence and lets the person decide.
 *
 * Fetched on catalogItemId alone, unlike CatalogMatchHint: catalogItemId
 * only changes on an explicit pick or an accepted match suggestion, both
 * discrete events rather than something a person free-types into, so
 * there's nothing here that needs debouncing or a blur trigger — the
 * effect's dependency array is enough. Guarded the same way
 * PriceHistoryHint is, with a `cancelled` flag rather than a request
 * counter, since there's exactly one thing that can trigger a fetch here.
 *
 * Renders nothing when there's no catalogue item or nothing is committed
 * — most lines will have nothing to say, and a hint that fires on every
 * line would just be noise a person learns to ignore.
 */
export function CommitmentHint({ catalogItemId }: { catalogItemId: string | null }) {
  const [commitments, setCommitments] = useState<OpenCommitments | null>(null);

  useEffect(() => {
    // Mirrors PriceHistoryHint: no reset to null when catalogItemId
    // clears — the render guard below already keys off catalogItemId
    // first, so a stale `commitments` value from a previous item never
    // gets shown once the item is cleared.
    if (!catalogItemId) return;
    let cancelled = false;
    getOpenCommitments({ catalogItemId }).then((groups) => {
      if (!cancelled) setCommitments(groups);
    });
    return () => {
      cancelled = true;
    };
  }, [catalogItemId]);

  if (!catalogItemId || !commitments || commitments.length === 0) return null;

  return (
    <p className="mt-1 text-xs text-muted-foreground">
      {commitments.map((group, i) => (
        <span key={group.uom}>
          {i > 0 && " · "}
          {describeGroup(group)}
        </span>
      ))}
    </p>
  );
}

// Each group already carries a single uom (see db/itemCommitments.ts),
// so everything joined here stays within that one group — this is what
// keeps "10 boxes" and "100 each" from ever getting summed into one
// confidently wrong number. Groups themselves are joined with " · " above,
// each still labelled by its own uom, rather than combined into a total.
function describeGroup(group: CommitmentsByUom): string {
  const parts: string[] = [];

  if (group.onOrder.length > 0) {
    if (group.onOrder.length === 1) {
      const ref = group.onOrder[0];
      parts.push(`${ref.outstandingQuantity} ${group.uom} on order (${ref.poNumber}, ${ref.vendorName})`);
    } else {
      const refs = group.onOrder.map((r) => `${r.poNumber}, ${r.vendorName}`).join("; ");
      parts.push(`${group.onOrderTotal} ${group.uom} on order (${refs})`);
    }
  }

  if (group.pipeline.length > 0) {
    parts.push(`${group.pipelineTotal} ${group.uom} more awaiting approval`);
  }

  return parts.join(" · ");
}
