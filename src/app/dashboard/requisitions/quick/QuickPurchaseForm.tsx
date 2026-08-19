"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createRequisition, previewDuplicates, type LineInput } from "../actions";
import type { PossibleDuplicate } from "@/db/duplicateDetection";
import { Step2Basics } from "../wizard/Step2Basics";
import { LineItemsTable } from "../wizard/LineItemsTable";
import { DuplicateWarningPanel } from "../wizard/DuplicateWarningPanel";
import { emptyLine, type Line, type Department, type CostCenter, type Category, type CatalogItem } from "../wizard/types";

/**
 * The short route: a single-line, no-document requisition on one screen.
 * Reuses the same building blocks as the full wizard (Step2Basics,
 * LineItemsTable, createRequisition) but skips everything the wizard
 * exists to handle — document upload/extraction, line-matching, step
 * navigation, and the approver-preview panel. For a simple ask, there's
 * nothing to reconcile.
 */
export function QuickPurchaseForm({
  departments,
  costCenters,
  categories,
  catalogItems,
  committedByCostCenter,
}: {
  departments: Department[];
  costCenters: CostCenter[];
  categories: Category[];
  catalogItems: CatalogItem[];
  committedByCostCenter: Record<string, number>;
}) {
  const router = useRouter();
  const [departmentId, setDepartmentId] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const [justification, setJustification] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [duplicates, setDuplicates] = useState<PossibleDuplicate[]>([]);
  const [duplicateReasons, setDuplicateReasons] = useState<Record<string, string>>({});

  const updateLine = (key: string, patch: Partial<Line>) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const total = useMemo(
    () => lines.reduce((sum, l) => sum + Number(l.quantity || 0) * Number(l.estimatedUnitPrice || 0), 0),
    [lines],
  );

  // The short route is not an exemption from the duplicate check — same
  // fetch-on-catalogue-item shape as RequisitionForm's Step4Review panel,
  // just rendered inline since this form has no review step to hang it
  // on. See DuplicateWarningPanel and db/duplicateDetection.ts.
  const catalogItemIdsKey = [...new Set(lines.map((l) => l.catalogItemId).filter((id): id is string => !!id))]
    .sort()
    .join(",");
  useEffect(() => {
    let cancelled = false;
    const catalogItemIds = catalogItemIdsKey.split(",").filter(Boolean);
    // No early return on an empty id list — see RequisitionForm's twin
    // effect for why: findPossibleDuplicates already answers "[]" for
    // that itself.
    void previewDuplicates({ catalogItemIds, excludeRequisitionId: null })
      .then((result) => {
        if (!cancelled) setDuplicates(result);
      })
      .catch(() => {
        if (!cancelled) setDuplicates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [catalogItemIdsKey]);

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

      const result = await createRequisition({
        departmentId: departmentId || null,
        costCenterId: costCenterId || null,
        justification,
        lines: cleanLines,
        submit: shouldSubmit,
        duplicateAcknowledgements: Object.entries(duplicateReasons)
          .filter(([, reason]) => reason.trim().length > 0)
          .map(([duplicateOfRequisitionId, reason]) => ({ duplicateOfRequisitionId, reason: reason.trim() })),
      });

      if (result.needsAcknowledgement) {
        setDuplicates(result.needsAcknowledgement);
        setError("Say why each flagged item isn't a duplicate before submitting.");
        return;
      }

      if (result.error) {
        setError(result.error);
        return;
      }
      router.push("/dashboard/requisitions");
    });
  };

  return (
    <div className="flex flex-col gap-6">
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

      <div className="flex flex-col gap-3">
        <h2 className="font-serif text-base text-foreground">What is this for?</h2>
        <LineItemsTable
          lines={lines}
          categories={categories}
          catalogItems={catalogItems}
          updateLine={updateLine}
          removeLine={() => {}}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Justification</label>
        <textarea
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          rows={2}
          className="w-full max-w-2xl rounded-md border px-2 py-1 text-sm"
        />
      </div>

      <DuplicateWarningPanel
        duplicates={duplicates}
        itemName={itemName}
        reasons={duplicateReasons}
        onReasonChange={setDuplicateReason}
      />

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <button type="button" disabled={isPending} onClick={() => submit(false)} className={cn(buttonVariants({ variant: "outline" }))}>
          Save draft
          <span className="font-normal opacity-70"> · only you see it</span>
        </button>
        <button type="button" disabled={isPending} onClick={() => submit(true)} className={cn(buttonVariants())}>
          Submit for approval
        </button>
      </div>
    </div>
  );
}
