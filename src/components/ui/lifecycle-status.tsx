import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { stageBadgeVariant, nextStep, waitedFor, type NextStepContext } from "@/lib/lifecycle";

/**
 * The one status+next-action treatment every transaction page should
 * use — a stage string from computeStage()/poStage()/invoiceStage()/
 * sourcingStage(), never a raw enum. `detail` overrides the generic
 * summary when the caller has something more specific to say — e.g.
 * approvalStepDetail()'s "Step 1 of 2" for a requisition mid-way through
 * a multi-group approval chain.
 *
 * `waitingOn`, `since` and `action` are additive: a caller that passes
 * none of them gets exactly what this component always rendered. They
 * exist because "whose desk is it on, and for how long" is the question
 * a status badge never answered, and most pages already hold the data
 * needed to answer it.
 */
export function LifecycleStatus({
  stage,
  detail,
  className,
  ...context
}: {
  stage: string;
  detail?: string | null;
  className?: string;
} & NextStepContext) {
  const step = nextStep(stage, context);
  const waited = waitedFor(step.since);

  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <Badge variant={stageBadgeVariant(stage)}>{stage}</Badge>
      <span className="text-xs text-muted-foreground">{detail ?? step.summary}</span>

      {step.waitingOn && !step.terminal && (
        <span className="text-xs text-muted-foreground">
          With <span className="text-foreground">{step.waitingOn.name}</span>
          {step.waitingOn.role && ` · ${step.waitingOn.role}`}
          {waited && ` · ${waited}`}
        </span>
      )}

      {step.action && (
        <Link href={step.action.href} className="w-fit text-xs text-primary underline underline-offset-2">
          {step.action.label}
        </Link>
      )}
    </div>
  );
}
