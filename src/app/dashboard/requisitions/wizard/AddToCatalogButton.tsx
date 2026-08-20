"use client";

import { useState, useTransition } from "react";
import { createCatalogItemFromLine } from "../actions";

/**
 * Lets a requester add their free-text description straight to the
 * catalogue instead of needing an admin to do it separately — Admin ›
 * Catalogue remains where it's reviewed or enriched afterwards (it
 * already lists every item's status, including the "unverified" default
 * this creates with, same as an admin-created item gets).
 *
 * The actual duplicate check happens server-side in
 * createCatalogItemFromLine, not here — this component doesn't know
 * whether CatalogMatchHint already found (or was dismissed on) a match
 * for the same text, so it can't safely skip re-checking.
 */
export function AddToCatalogButton({
  description,
  uom,
  categoryId,
  onCreated,
}: {
  description: string | null;
  uom: string;
  categoryId: string | null;
  onCreated: (item: { id: string; uom: string; categoryId: string | null }) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const trimmed = (description ?? "").trim();
  if (trimmed.length < 3) return null;

  const create = () => {
    setError(null);
    startTransition(async () => {
      const result = await createCatalogItemFromLine({ name: trimmed, uom, categoryId });
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.item) onCreated(result.item);
    });
  };

  return (
    <div className="text-xs">
      <button
        type="button"
        disabled={isPending}
        onClick={create}
        className="text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-60"
      >
        {isPending ? "Checking…" : "+ Add to catalogue"}
      </button>
      {error && <p className="mt-0.5 max-w-56 text-destructive">{error}</p>}
    </div>
  );
}
