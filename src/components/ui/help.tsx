"use client";

import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { GLOSSARY, type GlossaryKey } from "@/lib/glossary";
import { cn } from "@/lib/utils";

/**
 * The three help primitives the rest of the app explains itself with.
 *
 * They are layered deliberately, cheapest and most visible first — a tooltip
 * only ever reaches someone who already suspects they don't understand and
 * bothers to hover, which is not the person we are worried about:
 *
 *   <PageHelp>  a standing, dismissible explanation of what a page is for
 *   <Term>      domain vocabulary, defined once in src/lib/glossary.ts
 *   <Info>      a question mark against one control, field or badge
 *
 * All three are Popover rather than Tooltip, which is not the obvious choice.
 * Base UI's Tooltip opens on hover and focus but never on tap, so on a phone
 * — which is where a warehouse or site user actually meets this app — every
 * tooltip in the product would be dead. Popover with `openOnHover` behaves
 * like a tooltip with a pointer and like a disclosure without one.
 */

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

const POPUP_CLASS = cn(
  "z-50 max-w-64 rounded-lg bg-popover px-3 py-2.5 text-popover-foreground shadow-lg",
  "outline outline-border/60",
  "origin-[var(--transform-origin)] transition-[opacity,transform] duration-150",
  "data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
  "data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
);

/**
 * A question mark against a single control, field, badge or column heading.
 *
 * Every one of these answers the same three things in the same order —
 * `title` is what it is called, `children` is what it is, and `next` is what
 * happens if you act on it. The third is the one that is usually missing and
 * the only one a user is actually asking about.
 */
export function Info({
  title,
  next,
  side = "top",
  className,
  children,
}: {
  title: string;
  next?: string;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
  children: ReactNode;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={120}
        closeDelay={80}
        aria-label={`What is ${title}?`}
        className={cn(
          "ml-1 inline-grid size-3.5 shrink-0 translate-y-px place-items-center rounded-full align-middle",
          "border border-input bg-background text-[9px] leading-none font-bold text-muted-foreground",
          "transition-colors hover:border-primary hover:text-primary",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
          "aria-expanded:border-primary aria-expanded:text-primary",
          className,
        )}
      >
        ?
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side={side} sideOffset={6} align="center" collisionPadding={12} className="z-50">
          <Popover.Popup className={POPUP_CLASS}>
            <Popover.Title className="text-xs font-semibold">{title}</Popover.Title>
            <Popover.Description
              render={<div />}
              className="mt-1 text-xs leading-relaxed text-popover-foreground/75"
            >
              {children}
            </Popover.Description>
            {next && <p className="mt-1.5 text-xs leading-relaxed text-primary">{next}</p>}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * A word from src/lib/glossary.ts, underlined where it appears in prose.
 *
 * The app keeps the formal procurement vocabulary — requisition, RFQ, goods
 * receipt — because that is what customers call these things everywhere
 * outside AWA. This is the component that makes keeping them affordable.
 *
 * `children` overrides the displayed text so the term can be bent to fit the
 * sentence around it ("three-way matched") while still pointing at the one
 * definition.
 */
export function Term({
  name,
  sentenceCase = false,
  className,
  children,
}: {
  name: GlossaryKey;
  /**
   * Lower-cases the first letter for use mid-sentence. The glossary
   * stores each term title-cased because that is how it reads as a popup
   * heading and in a glossary listing, which meant every inline use came
   * out as "record a Goods receipt". Only the first character is touched,
   * so acronyms ("RFQ") and proper nouns survive.
   */
  sentenceCase?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const entry = GLOSSARY[name];
  const label = sentenceCase ? entry.term.charAt(0).toLowerCase() + entry.term.slice(1) : entry.term;

  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={120}
        closeDelay={80}
        render={<button type="button" />}
        className={cn(
          "cursor-help border-b border-dashed border-primary/70 text-left font-[inherit] text-[length:inherit]",
          "transition-colors hover:bg-primary/8 aria-expanded:bg-primary/8",
          "focus-visible:rounded-xs focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
          className,
        )}
      >
        {children ?? label}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" sideOffset={6} align="center" collisionPadding={12} className="z-50">
          <Popover.Popup className={cn(POPUP_CLASS, "max-w-72")}>
            <Popover.Title className="text-xs font-semibold">{entry.term}</Popover.Title>
            <Popover.Description className="mt-1 text-xs leading-relaxed text-popover-foreground/75">
              {entry.definition}
            </Popover.Description>
            {entry.soWhat && <p className="mt-1.5 text-xs leading-relaxed text-primary">{entry.soWhat}</p>}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * The standing "how this page works" panel — what a colleague sitting next to
 * you would say, in three steps, before you touched anything.
 *
 * Dismissal is per-user-per-browser in localStorage rather than on the users
 * row: it is a display preference, it changes several times while someone is
 * learning, and none of it is worth a write to the database or a column to
 * migrate later. Dismissed, it collapses to a link rather than vanishing —
 * an explanation you cannot get back is one people close without reading.
 */
export function PageHelp({
  id,
  title,
  steps,
  className,
}: {
  id: string;
  title: string;
  /**
   * Keyed rather than a bare ReactNode[]: a step is often JSX (it carries
   * <Term>s), and an array literal of elements with no keys makes React
   * warn at the call site, where the fix is unobvious. A record forces a
   * key without the caller having to think about Fragment.
   */
  steps: Record<string, ReactNode>;
  className?: string;
}) {
  const storageKey = `awa.pagehelp.${id}`;
  // Rendered open on the server, since that is the right default for a user
  // who has never seen it. The effect below runs before paint, so a returning
  // user does not watch it collapse.
  const [dismissed, setDismissed] = useState(false);

  useIsomorphicLayoutEffect(() => {
    try {
      if (window.localStorage.getItem(storageKey) === "dismissed") setDismissed(true);
    } catch {
      // Private mode, or storage disabled — showing the panel is the safe miss.
    }
  }, [storageKey]);

  const persist = (value: boolean) => {
    setDismissed(value);
    try {
      if (value) window.localStorage.setItem(storageKey, "dismissed");
      else window.localStorage.removeItem(storageKey);
    } catch {
      // Same as above: the panel still behaves correctly for this page view.
    }
  };

  if (dismissed) {
    return (
      <button
        type="button"
        onClick={() => persist(false)}
        className={cn(
          "w-fit text-xs text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground",
          "focus-visible:rounded-xs focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
          className,
        )}
      >
        {title}
      </button>
    );
  }

  return (
    <section
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border border-primary/25 bg-primary/6 px-3.5 py-3",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        <button
          type="button"
          onClick={() => persist(true)}
          className={cn(
            "shrink-0 text-xs text-muted-foreground transition-colors hover:text-foreground",
            "focus-visible:rounded-xs focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
          )}
        >
          Dismiss
        </button>
      </div>
      <ol className="ml-4 flex list-decimal flex-col gap-1 text-xs leading-relaxed text-muted-foreground">
        {Object.entries(steps).map(([key, step]) => (
          <li key={key}>{step}</li>
        ))}
      </ol>
    </section>
  );
}
