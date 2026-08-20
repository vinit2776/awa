"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LIFECYCLE_STEPS, type LifecycleStepKey } from "@/lib/lifecycle";
import { GLOSSARY, allGlossaryEntries, type GlossaryKey } from "@/lib/glossary";

const SECTIONS = [
  "What AWA is for",
  "The seven stages",
  "Which parts are mine",
  "Words we use",
  "If something looks stuck",
  "Questions people ask us",
] as const;

const STAGE_TITLE: Record<LifecycleStepKey, string> = {
  requisition: "Someone asks for something",
  approval: "Someone with authority agrees",
  sourcing: "A vendor is chosen",
  purchase_order: "The order goes out",
  receipt: "Somebody confirms it turned up",
  invoice: "The bill gets checked",
  payment: "It gets paid",
};

const QUICK_CHIPS: GlossaryKey[] = [
  "requisition",
  "rfq",
  "cost-center",
  "three-way-match",
  "goods-receipt",
  "approval-rule",
];

/**
 * Only "The seven stages" is built out for v1, per the design handoff —
 * the other five sections are placeholders so the contents nav shows the
 * eventual shape without promising content that doesn't exist yet.
 */
export function HelpClient({
  initialTerm,
  ownedStages,
}: {
  initialTerm: GlossaryKey | null;
  ownedStages: LifecycleStepKey[];
}) {
  const [section, setSection] = useState<(typeof SECTIONS)[number]>("The seven stages");
  const [term, setTerm] = useState<GlossaryKey>(initialTerm ?? "requisition");
  const [query, setQuery] = useState("");

  const owned = new Set(ownedStages);
  const entry = GLOSSARY[term];

  const filtered = query.trim()
    ? allGlossaryEntries().filter(
        (e) => e.term.toLowerCase().includes(query.toLowerCase()) || e.key.includes(query.toLowerCase()),
      )
    : allGlossaryEntries().filter((e) => (QUICK_CHIPS as string[]).includes(e.key));

  const onQueryChange = (value: string) => {
    setQuery(value);
    if (!value.trim()) return;
    const match = allGlossaryEntries().find(
      (e) => e.key.includes(value.toLowerCase()) || e.term.toLowerCase().includes(value.toLowerCase()),
    );
    if (match) setTerm(match.key);
  };

  return (
    <div className="flex flex-1">
      <nav className="flex w-[210px] shrink-0 flex-col gap-0.5 border-r border-border px-4 py-7">
        <p className="mb-2 px-2 text-[11px] tracking-[0.08em] text-muted-foreground uppercase">Contents</p>
        {SECTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSection(s)}
            className={cn(
              "rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
              s === section ? "bg-primary/10 font-medium text-primary" : "text-foreground/75 hover:bg-muted",
            )}
          >
            {s}
          </button>
        ))}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col gap-5 px-8 py-7">
        {section === "The seven stages" ? (
          <>
            <div>
              <h1 className="font-serif text-2xl text-foreground">The seven stages</h1>
              <p className="mt-1 max-w-[62ch] text-sm text-muted-foreground">
                Everything AWA does is one of these, in this order. The bold name is what we call it on screen;
                the underlined name is what auditors and paperwork call it.
              </p>
            </div>

            <ol className="flex flex-col gap-2.5">
              {LIFECYCLE_STEPS.map((step, i) => {
                const glossaryEntry = GLOSSARY[step.term];
                const mine = owned.has(step.key);
                return (
                  <Card key={step.key} className="p-4">
                    <div className="flex flex-wrap items-baseline gap-2.5">
                      <span className="font-mono text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                      <p className="text-[15px] font-medium">{STAGE_TITLE[step.key]}</p>
                      <button
                        type="button"
                        onClick={() => setTerm(step.term)}
                        className="border-b border-dashed border-primary/70 text-xs text-muted-foreground hover:text-primary"
                      >
                        {step.label.toLowerCase()}
                      </button>
                      {mine && <span className="ml-auto text-[11.5px] font-medium text-primary">yours</span>}
                    </div>
                    <p className="mt-2.5 max-w-[70ch] text-[13.5px] leading-relaxed text-muted-foreground">
                      {glossaryEntry.definition}
                    </p>
                  </Card>
                );
              })}
            </ol>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <p className="max-w-sm text-center text-sm text-muted-foreground">
              This section isn&apos;t written yet — start with &ldquo;The seven stages&rdquo; on the left.
            </p>
          </div>
        )}
      </div>

      <aside className="flex w-[300px] shrink-0 flex-col gap-3.5 border-l border-border bg-muted/40 px-5 py-6">
        <p className="text-[11px] tracking-[0.08em] text-muted-foreground uppercase">Words we use</p>
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Look up a word…"
          className="h-[34px] rounded-md border border-input bg-background px-2.5 text-sm"
        />

        <Card className="bg-background p-3.5">
          <p className="text-sm font-medium">{entry.term}</p>
          <p className="mt-2 text-[11.5px] tracking-[0.06em] text-muted-foreground uppercase">In plain words</p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{entry.definition}</p>
          {entry.soWhat && (
            <>
              <p className="mt-2.5 text-[11.5px] tracking-[0.06em] text-muted-foreground uppercase">Why it matters</p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{entry.soWhat}</p>
            </>
          )}
        </Card>

        <div className="flex flex-wrap gap-1.5">
          {filtered.slice(0, 12).map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => setTerm(chip.key)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                chip.key === term ? "border-primary text-primary" : "border-input text-muted-foreground hover:border-primary/50",
              )}
            >
              {chip.term}
            </button>
          ))}
        </div>

        <p className="mt-auto text-xs leading-relaxed text-muted-foreground">
          Every underlined word in AWA opens this panel — the definition is the same one, written once.
        </p>
      </aside>
    </div>
  );
}
