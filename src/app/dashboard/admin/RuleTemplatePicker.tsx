"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ApprovalPreview } from "@/db/approvalPreview";
import { ApprovalChainSummary } from "../requisitions/wizard/ApprovalChainSummary";
import { createRuleWithRequirements } from "./approval-rules/actions";

type Role = { id: string; key: string; displayName: string };

const TEMPLATES = [
  {
    key: "single",
    title: "The manager of whoever asks",
    desc: "Anything over 0 goes to that person's department head. One step, nobody left out.",
  },
  {
    key: "two",
    title: "Manager, then finance over 50,000",
    desc: "Small things move fast; anything material gets a second pair of eyes.",
  },
  {
    key: "custom",
    title: "Write my own",
    desc: "The full rule matrix — amount, department, category, several signatories.",
  },
] as const;

type TemplateKey = (typeof TEMPLATES)[number]["key"];

/**
 * "Who has to sign off," turned from a link out to the full rule builder
 * into a pick-a-template-and-go — the builder still exists for "custom",
 * unchanged, at /dashboard/admin/approval-rules.
 *
 * The "two-step" template needs two separate approvalRules rows, not one
 * rule with two groups: createRuleWithRequirements's groups always run in
 * sequence for every requisition that matches the rule, so "finance only
 * gets involved over 50,000" has to be two value-ranged rules (0–49,999.99
 * single-step, 50,000+ two-step) rather than one rule whose second group
 * is conditional. A single rule can't express that condition.
 */
export function RuleTemplatePicker({ roles }: { roles: Role[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<TemplateKey>("two");
  const [isPending, startTransition] = useTransition();
  const [activated, setActivated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const departmentHead = roles.find((r) => r.key === "department_head");
  const financeApprover = roles.find((r) => r.key === "finance_approver");

  const preview: ApprovalPreview | null = !departmentHead
    ? null
    : {
        autoApproves: false,
        ruleNames: [selected === "single" ? "Manager approval" : "Manager, then finance"],
        steps: [
          { groupNo: 1, roleName: departmentHead.displayName, approvers: [departmentHead.displayName] },
          ...(selected === "two" && financeApprover
            ? [{ groupNo: 2, roleName: financeApprover.displayName, approvers: [financeApprover.displayName] }]
            : []),
        ],
      };

  const activate = () => {
    if (!departmentHead) return;
    setError(null);
    startTransition(async () => {
      if (selected === "single") {
        const result = await createRuleWithRequirements({
          name: "Manager approval",
          categoryId: null,
          departmentId: null,
          costCenterId: null,
          minValue: "0",
          maxValue: null,
          combinationMode: "exclusive",
          priority: 1,
          steps: [[{ approverRoleId: departmentHead.id, minApprovalsInGroup: 1 }]],
          ruleType: "requires_approval",
        });
        if (result.error) {
          setError(result.error);
          return;
        }
      } else if (selected === "two") {
        if (!financeApprover) {
          setError("This template needs a finance approver role — add one under Roles first.");
          return;
        }
        const low = await createRuleWithRequirements({
          name: "Manager approval (under 50,000)",
          categoryId: null,
          departmentId: null,
          costCenterId: null,
          minValue: "0",
          maxValue: "49999.99",
          combinationMode: "exclusive",
          priority: 1,
          steps: [[{ approverRoleId: departmentHead.id, minApprovalsInGroup: 1 }]],
          ruleType: "requires_approval",
        });
        if (low.error) {
          setError(low.error);
          return;
        }
        const high = await createRuleWithRequirements({
          name: "Manager, then finance (50,000 and over)",
          categoryId: null,
          departmentId: null,
          costCenterId: null,
          minValue: "50000",
          maxValue: null,
          combinationMode: "exclusive",
          priority: 1,
          steps: [
            [{ approverRoleId: departmentHead.id, minApprovalsInGroup: 1 }],
            [{ approverRoleId: financeApprover.id, minApprovalsInGroup: 1 }],
          ],
          ruleType: "requires_approval",
        });
        if (high.error) {
          setError(high.error);
          return;
        }
      }
      setActivated(true);
      // createRuleWithRequirements only revalidates the approval-rules
      // page — this checklist's own "done" state (activeRules.length > 0)
      // is computed here, on /dashboard/admin, which needs its own
      // refresh to pick the new rule up without a manual reload.
      router.refresh();
    });
  };

  if (selected === "custom") {
    return (
      <div className="flex flex-col gap-3">
        <TemplateOptions selected={selected} onSelect={setSelected} />
        <Link
          href="/dashboard/admin/approval-rules"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-fit")}
        >
          Open the rule builder
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap gap-4">
        <div className="min-w-[300px] flex-1 rounded-lg border border-border bg-background p-3.5">
          <p className="text-[11px] tracking-[0.08em] text-muted-foreground uppercase">Start from a common one</p>
          <TemplateOptions selected={selected} onSelect={setSelected} className="mt-2.5" />
        </div>
        <div className="min-w-[260px] flex-1 rounded-lg border border-border bg-muted/50 p-3.5">
          <p className="text-[11px] tracking-[0.08em] text-muted-foreground uppercase">Rehearsal</p>
          {departmentHead ? (
            <div className="mt-2.5">
              <ApprovalChainSummary preview={preview} />
              <p className="mt-2.5 text-xs text-muted-foreground">
                Change the template on the left and this updates. Nothing is saved until you turn it on below.
              </p>
            </div>
          ) : (
            <p className="mt-2.5 text-xs text-muted-foreground">
              Set up roles first — this needs a department head to rehearse against.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          disabled={isPending || !departmentHead}
          onClick={activate}
          className={cn(buttonVariants({ size: "sm" }))}
        >
          Turn this rule on
        </button>
        {error && <span className="text-xs text-destructive">{error}</span>}
        {activated && (
          <span className="text-xs font-medium text-success">
            Rule turned on — requests now route for approval.
          </span>
        )}
      </div>
    </div>
  );
}

function TemplateOptions({
  selected,
  onSelect,
  className,
}: {
  selected: TemplateKey;
  onSelect: (key: TemplateKey) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {TEMPLATES.map((t) => (
        <label
          key={t.key}
          className={cn(
            "flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5",
            selected === t.key ? "border-primary bg-primary/5" : "border-border",
          )}
        >
          <input
            type="radio"
            name="rule-template"
            checked={selected === t.key}
            onChange={() => onSelect(t.key)}
            className="mt-1"
          />
          <span>
            <span className="block text-sm font-medium">{t.title}</span>
            <span className="block text-xs text-muted-foreground">{t.desc}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
