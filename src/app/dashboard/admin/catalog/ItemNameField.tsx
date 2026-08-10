"use client";

import { useState, useTransition } from "react";
import { searchSimilarItems } from "./actions";

type Match = { id: string; name: string; status: string; similarity: number };

export function ItemNameField() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [isPending, startTransition] = useTransition();

  const onChange = (value: string) => {
    startTransition(async () => {
      setMatches(await searchSimilarItems(value));
    });
  };

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="name" className="text-xs text-muted-foreground">New item</label>
      <input
        id="name"
        name="name"
        required
        autoComplete="off"
        className="h-8 w-56 rounded-md border px-2 text-sm"
        placeholder="e.g. Ball valve 2 inch"
        onChange={(e) => onChange(e.target.value)}
      />
      {matches.length > 0 && (
        <div className="w-56 rounded-md border bg-popover p-2 text-xs">
          <p className="mb-1 text-muted-foreground">Possibly similar — check before adding a duplicate:</p>
          <ul className="flex flex-col gap-0.5">
            {matches.map((m) => (
              <li key={m.id} className="flex justify-between gap-2">
                <span>{m.name}</span>
                <span className="text-muted-foreground">{m.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {isPending && <p className="text-xs text-muted-foreground">Checking…</p>}
    </div>
  );
}
