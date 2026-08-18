import Link from "next/link";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Info } from "@/components/ui/help";
import { cn } from "@/lib/utils";

/**
 * The search-and-filter bar every list page uses.
 *
 * Shared so twelve pages don't drift into twelve dialects of the same
 * control: same field order, same info dot on the search box explaining
 * what it actually matches, same Clear, same "N shown" count in the same
 * corner. A person who learns it on Requisitions knows it on Payments.
 *
 * A plain GET form, server-rendered, no client JavaScript — matching how
 * every filter in AWA already works, and meaning the URL is the state, so
 * a filtered list can be linked to and bookmarked.
 */
export function ListControls({
  q,
  searchPlaceholder,
  searchMatches,
  hiddenFields,
  clearHref,
  count,
  children,
}: {
  /** Current search term, echoed back into the field. */
  q: string;
  searchPlaceholder: string;
  /** What this page's search looks at — the sentence shown in the info dot. */
  searchMatches: string;
  /** Filter state to preserve across a submit that doesn't include it (sort, mostly). */
  hiddenFields?: Record<string, string | null | undefined>;
  /** Where "Clear" goes. Omit to hide it. */
  clearHref?: string;
  count: number;
  /** Page-specific selects. */
  children?: ReactNode;
}) {
  return (
    <form method="GET" className="flex flex-wrap items-end gap-2">
      {Object.entries(hiddenFields ?? {}).map(([name, value]) =>
        value ? <input key={name} type="hidden" name={name} value={value} /> : null,
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="q" className="text-xs text-muted-foreground">
          Search
          <Info title="What gets searched" next="Combine it with the filters — search narrows what they return.">
            Matches on {searchMatches}.
          </Info>
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={q}
          placeholder={searchPlaceholder}
          className="h-8 w-60 rounded-md border px-2 text-sm"
        />
      </div>

      {children}

      <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
        Filter
      </button>

      {clearHref && (
        <Link href={clearHref} className="text-xs text-muted-foreground underline underline-offset-2">
          Clear
        </Link>
      )}

      <span className="ml-auto self-center text-xs text-muted-foreground">{count} shown</span>
    </form>
  );
}

/** A labelled select, so the page-specific filters line up with the search field. */
export function ListFilter({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={name} className="text-xs text-muted-foreground">
        {label}
      </label>
      <select id={name} name={name} defaultValue={value} className="h-8 rounded-md border px-2 text-sm">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
