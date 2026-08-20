"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  previewApprovers,
  previewDuplicates,
  createRequisition,
  reviseAndResubmitRequisition,
  getRequisitionDocumentUploadUrl,
  extractRequisitionFromDocument,
  type LineInput,
} from "./actions";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import type { ApprovalPreview } from "@/db/approvalPreview";
import type { ExtractedDocumentMeta } from "@/db/documentExtraction";
import type { PossibleDuplicate } from "@/db/duplicateDetection";
import { Step1Document } from "./wizard/Step1Document";
import { Step2Basics } from "./wizard/Step2Basics";
import { Step3LineItems } from "./wizard/Step3LineItems";
import { Step4Review } from "./wizard/Step4Review";
import { RequestConsequencesRail } from "./wizard/RequestConsequencesRail";
import { computeBudgetStatus } from "./wizard/budgetStatus";
import { emptyLine, buildExistingLineRefs, type Line, type PendingMatch, type Department, type CostCenter, type Category, type CatalogItem } from "./wizard/types";

type Revision = {
  requisitionId: string;
  initial: {
    departmentId: string | null;
    costCenterId: string | null;
    justification: string;
    lines: LineInput[];
  };
};

type StepName = "document" | "basics" | "lines" | "review";
const STEP_LABEL: Record<StepName, string> = { document: "Document", basics: "Basics", lines: "Line items", review: "Review" };

export function RequisitionForm({
  departments,
  costCenters,
  categories,
  catalogItems,
  committedByCostCenter,
  revision,
}: {
  departments: Department[];
  costCenters: CostCenter[];
  categories: Category[];
  catalogItems: CatalogItem[];
  committedByCostCenter: Record<string, number>;
  revision?: Revision;
}) {
  const router = useRouter();
  const steps: StepName[] = revision ? ["basics", "lines", "review"] : ["document", "basics", "lines", "review"];

  const [stepIndex, setStepIndex] = useState(0);
  const [maxVisited, setMaxVisited] = useState(0);
  const step = steps[stepIndex];
  const goToStep = (name: StepName) => {
    const i = steps.indexOf(name);
    if (i < 0) return;
    setStepIndex(i);
    setMaxVisited((prev) => Math.max(prev, i));
  };

  const [departmentId, setDepartmentId] = useState(revision?.initial.departmentId ?? "");
  const [costCenterId, setCostCenterId] = useState(revision?.initial.costCenterId ?? "");
  const [justification, setJustification] = useState(revision?.initial.justification ?? "");
  const [lines, setLines] = useState<Line[]>(
    revision?.initial.lines.length
      ? revision.initial.lines.map((l) => ({ ...l, key: crypto.randomUUID() }))
      : [emptyLine()],
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [preview, setPreview] = useState<ApprovalPreview | null>(null);
  const [duplicates, setDuplicates] = useState<PossibleDuplicate[]>([]);
  const [duplicateReasons, setDuplicateReasons] = useState<Record<string, string>>({});

  const [sourceDocumentKey, setSourceDocumentKey] = useState<string | null>(null);
  const [documentMeta, setDocumentMeta] = useState<ExtractedDocumentMeta | null>(null);
  const [extractMessage, setExtractMessage] = useState<string | null>(null);
  const [isExtracting, startExtracting] = useTransition();
  const [pendingMatches, setPendingMatches] = useState<PendingMatch[]>([]);

  const extractFromDocument = (file: File) => {
    setExtractMessage(null);
    startExtracting(async () => {
      // Uploaded directly to R2 from the browser, not through a Server
      // Action — Vercel Functions cap request bodies at 4.5MB, well
      // under what a real scanned invoice can be.
      const presigned = await getRequisitionDocumentUploadUrl({
        fileName: file.name,
        mimeType: file.type,
        fileSize: file.size,
      });
      if (presigned.error || !presigned.uploadUrl || !presigned.key) {
        setExtractMessage(presigned.error ?? "Upload failed.");
        return;
      }

      const putResponse = await fetch(presigned.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putResponse.ok) {
        setExtractMessage("Upload failed. Please try again.");
        return;
      }

      const existingRefs = buildExistingLineRefs(lines, catalogItems);
      const result = await extractRequisitionFromDocument({
        key: presigned.key,
        existingLines: existingRefs.map(({ index, description }) => ({ index, description })),
      });

      if (result.sourceDocumentKey) setSourceDocumentKey(result.sourceDocumentKey);
      if (result.documentMeta) setDocumentMeta(result.documentMeta);
      if (result.error) setExtractMessage(result.error);

      if (result.lines && result.lines.length > 0) {
        const newMatches: PendingMatch[] = [];
        const newLines: Line[] = [];
        for (const l of result.lines) {
          const line: Line = {
            key: crypto.randomUUID(),
            catalogItemId: l.catalogItemId,
            freeTextDescription: l.freeTextDescription,
            categoryId: l.categoryId,
            fulfillmentType: l.fulfillmentType,
            quantity: l.quantity,
            uom: l.uom,
            estimatedUnitPrice: l.estimatedUnitPrice,
            priceConfirmed: l.priceConfirmed,
            fromExtraction: true,
          };
          const ref = l.matchesExistingLineIndex !== null
            ? existingRefs.find((r) => r.index === l.matchesExistingLineIndex)
            : undefined;
          if (ref) {
            newMatches.push({ id: crypto.randomUUID(), extracted: line, existingKey: ref.key, existingDescription: ref.description });
          } else {
            newLines.push(line);
          }
        }

        if (existingRefs.length === 0) {
          if (newLines.length > 0) setLines(newLines);
        } else if (newLines.length > 0) {
          setLines((prev) => [...prev, ...newLines]);
        }
        if (newMatches.length > 0) setPendingMatches((prev) => [...prev, ...newMatches]);
      }

      // The server only sets `error` when there was genuinely nothing
      // usable (no lines, no vendor detail) — a clean result always
      // means there's something worth seeing on the next step.
      if (step === "document" && !result.error) {
        goToStep("basics");
      }
    });
  };

  const updateLine = (key: string, patch: Partial<Line>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };
  const removeLine = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key));
  const addLine = () => setLines((prev) => [...prev, emptyLine()]);

  const resolveUpdateMatch = (match: PendingMatch) => {
    updateLine(match.existingKey, {
      freeTextDescription: match.extracted.freeTextDescription,
      catalogItemId: match.extracted.catalogItemId,
      quantity: match.extracted.quantity,
      uom: match.extracted.uom,
      estimatedUnitPrice: match.extracted.estimatedUnitPrice,
      priceConfirmed: true,
      fulfillmentType: match.extracted.fulfillmentType,
      fromExtraction: true,
    });
    setPendingMatches((prev) => prev.filter((m) => m.id !== match.id));
  };
  const resolveKeepSeparate = (match: PendingMatch) => {
    setLines((prev) => [...prev, match.extracted]);
    setPendingMatches((prev) => prev.filter((m) => m.id !== match.id));
  };

  const total = useMemo(
    () => lines.reduce((sum, l) => sum + Number(l.quantity || 0) * Number(l.estimatedUnitPrice || 0), 0),
    [lines],
  );
  const budgetStatus = computeBudgetStatus(costCenterId, costCenters, committedByCostCenter, total);
  // Same test the server applies (requisitions/actions.ts's validLines
  // filter) — the rail uses it to decide whether it has anything real to
  // offer to send yet.
  const hasContent = lines.some((l) => (l.catalogItemId || l.freeTextDescription?.trim()) && Number(l.quantity) > 0);

  // Refreshed whenever something that affects routing changes. Rules match
  // on value, department, cost centre and line category, so those are the
  // dependencies — not every keystroke in the form.
  const categoryKey = lines.map((l) => l.categoryId ?? "").sort().join(",");
  useEffect(() => {
    let cancelled = false;
    void previewApprovers({
      departmentId: departmentId || null,
      costCenterId: costCenterId || null,
      totalEstimatedValue: total.toFixed(2),
      categoryIds: categoryKey.split(",").filter(Boolean),
    })
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch(() => {
        // A preview that can't be fetched shows nothing rather than
        // guessing — submitting still works.
        if (!cancelled) setPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [departmentId, costCenterId, total, categoryKey]);

  // Same "fetch on the identifiers that actually matter, guard against a
  // stale response" shape as the approver preview above — keyed on the
  // set of catalogue items on the form, since that's the only thing
  // findPossibleDuplicates matches on (see db/duplicateDetection.ts:
  // deliberately no fuzzy-matching on free text).
  const catalogItemIdsKey = [...new Set(lines.map((l) => l.catalogItemId).filter((id): id is string => !!id))]
    .sort()
    .join(",");
  useEffect(() => {
    let cancelled = false;
    const catalogItemIds = catalogItemIdsKey.split(",").filter(Boolean);
    // No early return on an empty id list — findPossibleDuplicates
    // already answers "[]" for that itself, and resolving through the
    // same async path (rather than a synchronous setState here) keeps
    // this from cascading a render mid-effect.
    void previewDuplicates({ catalogItemIds, excludeRequisitionId: revision?.requisitionId ?? null })
      .then((result) => {
        if (!cancelled) setDuplicates(result);
      })
      .catch(() => {
        // A preview that can't be fetched shows nothing rather than
        // guessing — submitting still works, and the server re-runs this
        // same check before anything is persisted.
        if (!cancelled) setDuplicates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [catalogItemIdsKey, revision?.requisitionId]);

  const itemName = (catalogItemId: string) => catalogItems.find((i) => i.id === catalogItemId)?.name ?? null;
  const setDuplicateReason = (duplicateOfRequisitionId: string, reason: string) =>
    setDuplicateReasons((prev) => ({ ...prev, [duplicateOfRequisitionId]: reason }));

  const submit = (shouldSubmit: boolean) => {
    setError(null);
    startTransition(async () => {
      const cleanLines: LineInput[] = lines.map((l) => ({
        catalogItemId: l.catalogItemId,
        freeTextDescription: l.freeTextDescription,
        categoryId: l.categoryId,
        fulfillmentType: l.fulfillmentType,
        quantity: l.quantity,
        uom: l.uom,
        estimatedUnitPrice: l.estimatedUnitPrice,
        priceConfirmed: l.priceConfirmed,
      }));

      const result: { error?: string; id?: string; needsAcknowledgement?: PossibleDuplicate[] } = revision
        ? await reviseAndResubmitRequisition({
            requisitionId: revision.requisitionId,
            departmentId: departmentId || null,
            costCenterId: costCenterId || null,
            justification,
            lines: cleanLines,
          })
        : await createRequisition({
            departmentId: departmentId || null,
            costCenterId: costCenterId || null,
            justification,
            lines: cleanLines,
            submit: shouldSubmit,
            sourceDocumentKey,
            extractedDocumentMeta: documentMeta,
            duplicateAcknowledgements: Object.entries(duplicateReasons)
              .filter(([, reason]) => reason.trim().length > 0)
              .map(([duplicateOfRequisitionId, reason]) => ({ duplicateOfRequisitionId, reason: reason.trim() })),
          });

      if ("needsAcknowledgement" in result && result.needsAcknowledgement) {
        // The server is the authority — this may be a duplicate the
        // preview never showed (somebody else submitted a match in the
        // time between review and now). Show what it found and ask,
        // rather than a generic error: this is a prompt, not a failure.
        setDuplicates(result.needsAcknowledgement);
        setError("Say why each flagged item isn't a duplicate before submitting.");
        goToStep("review");
        return;
      }

      if (result.error) {
        setError(result.error);
        return;
      }
      router.push("/dashboard/requisitions");
    });
  };

  // The rail's Send button is reachable from every step, before
  // justification or duplicate-acknowledgement reasons (only entered on
  // Review) exist — so a click from anywhere but Review takes you there
  // first, rather than submitting invalid state. A second click, now on
  // Review, actually sends it.
  const handleSend = () => {
    if (step !== "review") {
      goToStep("review");
      return;
    }
    submit(true);
  };

  return (
    <div className="flex flex-col gap-7 lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <nav className="flex flex-wrap items-center gap-1 text-sm">
          {steps.map((s, i) => (
            <span key={s} className="flex items-center gap-1">
              {i > 0 && <span className="text-muted-foreground">›</span>}
              <button
                type="button"
                disabled={i > maxVisited}
                onClick={() => goToStep(s)}
                className={cn(
                  "rounded-md px-2 py-1",
                  i === stepIndex
                    ? "bg-primary/10 font-medium text-primary"
                    : i <= maxVisited
                      ? "text-muted-foreground hover:text-foreground"
                      : "text-muted-foreground/50",
                )}
              >
                {STEP_LABEL[s]}
              </button>
            </span>
          ))}
        </nav>

        {step === "document" && (
          <Step1Document
            isExtracting={isExtracting}
            extractMessage={extractMessage}
            onExtract={extractFromDocument}
            onSkip={() => goToStep("basics")}
          />
        )}

        {step === "basics" && (
          <Step2Basics
            departments={departments}
            costCenters={costCenters}
            departmentId={departmentId}
            costCenterId={costCenterId}
            setDepartmentId={setDepartmentId}
            setCostCenterId={setCostCenterId}
            total={total}
            committedByCostCenter={committedByCostCenter}
          />
        )}

        {step === "lines" && (
          <Step3LineItems
            lines={lines}
            categories={categories}
            catalogItems={catalogItems}
            updateLine={updateLine}
            removeLine={removeLine}
            addLine={addLine}
            total={total}
            documentMeta={documentMeta}
            sourceDocumentKey={sourceDocumentKey}
            pendingMatches={pendingMatches}
            onUpdateMatch={resolveUpdateMatch}
            onKeepMatchSeparate={resolveKeepSeparate}
          />
        )}

        {step === "review" && (
          <Step4Review
            justification={justification}
            setJustification={setJustification}
            error={error}
            duplicates={duplicates}
            itemName={itemName}
            duplicateReasons={duplicateReasons}
            onDuplicateReasonChange={setDuplicateReason}
            onEditLines={() => goToStep("lines")}
          />
        )}

        <div className="mt-2 flex items-center justify-center gap-4">
          <button
            type="button"
            disabled={stepIndex === 0}
            onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
            className="text-sm text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-0"
          >
            ← Back
          </button>
          {stepIndex < steps.length - 1 && (
            <button
              type="button"
              onClick={() => goToStep(steps[stepIndex + 1])}
              className={cn(buttonVariants({ variant: step === "lines" && !hasContent ? "outline" : "default" }), "px-6")}
            >
              Next →
            </button>
          )}
        </div>
      </div>

      <RequestConsequencesRail
        preview={preview}
        duplicates={duplicates}
        budgetStatus={budgetStatus}
        revision={!!revision}
        hasContent={hasContent}
        isPending={isPending}
        onSend={handleSend}
        onSaveDraft={() => submit(false)}
        onLookAtDuplicates={() => goToStep("review")}
      />
    </div>
  );
}
