import { LIFECYCLE_STEPS, railPosition } from "@/lib/lifecycle";
import { Term } from "@/components/ui/help";
import { cn } from "@/lib/utils";

/**
 * The seven-stage spine, rendered horizontally, from any stage string
 * computeStage()/poStage()/invoiceStage() returns.
 *
 * The point is that it is the *same* seven steps everywhere — on a
 * requisition, on a PO, on an invoice, in a list row — so the process is
 * learned once instead of re-inferred per page. It replaces the flat
 * list of grey dots on the lifecycle detail page, which showed the same
 * data but made position something you had to read seven lines to work
 * out rather than see.
 *
 * Colours are solid token fills, never opacity modifiers on the semantic
 * tokens — see the note in badge.tsx about Tailwind's derived
 * color-mix() utilities not reliably picking these up for newly-added
 * components.
 */
export function LifecycleRail({
  stage,
  captions,
  explain = false,
  compact = false,
  className,
}: {
  stage: string;
  /** Optional line under a step — a date, a count, "Step 1 of 2". Keyed by step. */
  captions?: Partial<Record<(typeof LIFECYCLE_STEPS)[number]["key"], string>>;
  /** Underline each step name as a glossary term. Wants room; leave off inside table cells. */
  explain?: boolean;
  /** Dots and rules only, no labels — for a list row. */
  compact?: boolean;
  className?: string;
}) {
  const { step: currentIndex, health } = railPosition(stage);

  // A finished chain has no "current" step — every stage reads complete,
  // including the one the record stopped on.
  const stateFor = (index: number) =>
    health === "done" || index < currentIndex ? "complete" : index === currentIndex ? "current" : "upcoming";

  const currentTone =
    health === "attention" ? "bg-warning" : health === "stopped" ? "bg-destructive" : "bg-primary";

  return (
    <ol
      aria-label={`Lifecycle — currently at ${LIFECYCLE_STEPS[currentIndex]?.label ?? "the start"}`}
      className={cn("flex items-stretch overflow-x-auto", className)}
    >
      {LIFECYCLE_STEPS.map((step, index) => {
        const state = stateFor(index);
        const tone = state === "complete" ? "bg-success" : state === "current" ? currentTone : "bg-border";

        return (
          <li
            key={step.key}
            aria-current={state === "current" ? "step" : undefined}
            className={cn("relative flex-1 pt-2", compact ? "min-w-8" : "min-w-20 pr-2")}
          >
            {/* The rule doubles as the connector to the next step, so it runs
                the full width of the cell rather than stopping at the label. */}
            <span aria-hidden="true" className={cn("absolute inset-x-0 top-0 h-0.5", tone)} />
            <span
              aria-hidden="true"
              className={cn(
                "absolute top-0 left-0 block -translate-y-1/2 rounded-full",
                tone,
                state === "current" ? "size-2.5" : "size-2",
              )}
            />

            {!compact && (
              <div className="pt-1">
                <p
                  className={cn(
                    "text-xs leading-tight",
                    state === "upcoming" ? "text-muted-foreground" : "font-medium text-foreground",
                  )}
                >
                  {explain ? <Term name={step.term}>{step.label}</Term> : step.label}
                </p>
                {captions?.[step.key] && (
                  <p className="mt-0.5 text-xs leading-tight text-muted-foreground">{captions[step.key]}</p>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
