"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useState } from "react";
import { LIFECYCLE_STEPS, type LifecycleStepKey } from "@/lib/lifecycle";
import { STAGE_OWNER_HINT } from "@/lib/roleStages";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
const STORAGE_KEY = "awa.welcome.seen";

/**
 * What somebody sees the first time they land on Today.
 *
 * A card at the top of the page rather than a modal tour: it doesn't
 * block the work, it can be read or ignored, and reopening it is a link
 * rather than a feature. A tour that can't be got back is one people
 * click through without reading.
 *
 * Dismissal lives in localStorage, like PageHelp — not a column on
 * users. It is a display preference; the cost of the honest alternative
 * is a migration and a permanent piece of schema for something cosmetic.
 * The tradeoff is real and small: a new browser shows it again, and the
 * card is short and skippable.
 */
export function WelcomeCard({
  firstName,
  roleNames,
  ownedStages,
}: {
  firstName: string;
  roleNames: string[];
  ownedStages: LifecycleStepKey[];
}) {
  const [seen, setSeen] = useState(false);

  useIsomorphicLayoutEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === "yes") setSeen(true);
    } catch {
      // Storage disabled — showing it is the safe miss.
    }
  }, []);

  const persist = (value: boolean) => {
    setSeen(value);
    try {
      if (value) window.localStorage.setItem(STORAGE_KEY, "yes");
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // As above.
    }
  };

  if (seen) {
    return (
      <button
        type="button"
        onClick={() => persist(false)}
        className={cn(
          "w-fit text-xs text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground",
          "focus-visible:rounded-xs focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        )}
      >
        What is AWA, and which parts are mine?
      </button>
    );
  }

  const owned = new Set(ownedStages);

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-primary/25 bg-primary/6 px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-base text-foreground">Welcome to AWA, {firstName}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            AWA runs buying — from asking for something, through approving and ordering it, to paying for it.
            {roleNames.length > 0 && (
              <>
                {" "}
                You hold {roleNames.length === 1 ? "the role" : "the roles"}{" "}
                <span className="text-foreground">{roleNames.join(" and ")}</span>.
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => persist(true)}
          className={cn(
            "shrink-0 text-xs text-muted-foreground transition-colors hover:text-foreground",
            "focus-visible:rounded-xs focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
          )}
        >
          Got it
        </button>
      </div>

      {/* The whole process once, with the reassuring half emphasised: most
          of it is not your job. */}
      <ol className="flex flex-wrap gap-1.5">
        {LIFECYCLE_STEPS.map((step) => {
          const mine = owned.has(step.key);
          return (
            <li
              key={step.key}
              className={cn(
                "rounded-md border px-2 py-1 text-xs",
                mine ? "border-primary/40 bg-primary/10 text-foreground" : "border-border text-muted-foreground",
              )}
            >
              <span className={cn(mine && "font-medium")}>{step.label}</span>
              <span className="ml-1 opacity-70">{mine ? "· you" : `· ${STAGE_OWNER_HINT[step.key]}`}</span>
            </li>
          );
        })}
      </ol>

      <p className="text-xs text-muted-foreground">
        {ownedStages.length} of {LIFECYCLE_STEPS.length} stages are yours. The rest happen without you — you can
        always see where anything has got to.
      </p>

      <div className="flex flex-wrap gap-2">
        <Link href="/dashboard/requisitions/new" className={cn(buttonVariants({ size: "sm" }))}>
          Raise your first requisition
        </Link>
        <Link
          href="/dashboard/requisitions?scope=all"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          See what others have raised
        </Link>
      </div>
    </section>
  );
}
