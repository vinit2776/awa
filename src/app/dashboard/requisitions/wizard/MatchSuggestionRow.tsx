import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PendingMatch } from "./types";

/**
 * "You typed 'X', the document says 'Y' — same thing?" A user-typed
 * description and a vendor's own wording (often a model number) can
 * refer to the same item with no shared substring, so this is presented
 * as a judgment call for the person, not applied silently either way.
 */
export function MatchSuggestionRow({
  match,
  onUpdate,
  onKeepSeparate,
}: {
  match: PendingMatch;
  onUpdate: () => void;
  onKeepSeparate: () => void;
}) {
  return (
    <div className="flex max-w-2xl flex-wrap items-center justify-between gap-2 rounded-md border border-primary/25 bg-primary/6 px-3 py-2 text-sm">
      <p>
        This looks like your <span className="font-medium">&ldquo;{match.existingDescription}&rdquo;</span> line —
        the document describes it as <span className="font-medium">&ldquo;{match.extracted.freeTextDescription}&rdquo;</span>.
      </p>
      <div className="flex shrink-0 gap-2">
        <button type="button" onClick={onUpdate} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Update it
        </button>
        <button type="button" onClick={onKeepSeparate} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Keep as new line
        </button>
      </div>
    </div>
  );
}
