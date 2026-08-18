import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * What a pipeline page says when it has nothing in it.
 *
 * Every one of these pages is empty for the first weeks of a deployment,
 * and several stay empty for any given user forever — so an empty table
 * with column headers and no rows is, in practice, the most-seen state
 * in the product. It should answer the three questions a person actually
 * has, in this order:
 *
 *   title     what this page is for
 *   children  why it is empty — what has to happen for something to land here
 *   actions   where the work is instead
 *
 * The third is the one that matters. "Nothing to source yet" is a dead
 * end; "nothing to source yet, and here are the two requisitions still
 * in approval" is a next step.
 */
export function EmptyState({
  title,
  children,
  actions,
  className,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-input px-6 py-10 text-center",
        className,
      )}
    >
      <p className="text-sm font-medium text-foreground">{title}</p>
      <div className="max-w-prose text-sm text-muted-foreground">{children}</div>
      {actions && <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
    </div>
  );
}
