"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  previewApprovers,
  createRequisition,
  reviseAndResubmitRequisition,
  getRequisitionDocumentUploadUrl,
  extractRequisitionFromDocument,
  type LineInput,
} from "./actions";
import { buttonVariants } from "@/components/ui/button";
import { Info, Term } from "@/components/ui/help";
import { cn } from "@/lib/utils";
import type { ApprovalPreview } from "@/db/approvalPreview";

type Department = { id: string; name: string };
type CostCenter = { id: string; name: string; annualBudget: string | null };
type Category = { id: string; name: string };
type CatalogItem = { id: string; name: string; categoryId: string | null; uom: string };

type Line = LineInput & { key: string };

const emptyLine = (): Line => ({
  key: crypto.randomUUID(),
  catalogItemId: null,
  freeTextDescription: null,
  categoryId: null,
  fulfillmentType: "goods",
  quantity: "1",
  uom: "each",
  estimatedUnitPrice: "0",
});

type Revision = {
  requisitionId: string;
  initial: {
    departmentId: string | null;
    costCenterId: string | null;
    justification: string;
    lines: LineInput[];
  };
};

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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sourceDocumentKey, setSourceDocumentKey] = useState<string | null>(null);
  const [extractedVendorName, setExtractedVendorName] = useState<string | null>(null);
  const [extractMessage, setExtractMessage] = useState<string | null>(null);
  const [isExtracting, startExtracting] = useTransition();

  const extractFromDocument = () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
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

      const result = await extractRequisitionFromDocument({ key: presigned.key });

      if (result.sourceDocumentKey) setSourceDocumentKey(result.sourceDocumentKey);
      if (result.vendorName) setExtractedVendorName(result.vendorName);
      if (result.error) setExtractMessage(result.error);

      if (result.lines && result.lines.length > 0) {
        setLines(result.lines.map((l) => ({ ...l, key: crypto.randomUUID() })));
      }
    });
  };

  const updateLine = (key: string, patch: Partial<Line>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const total = useMemo(
    () => lines.reduce((sum, l) => sum + Number(l.quantity || 0) * Number(l.estimatedUnitPrice || 0), 0),
    [lines],
  );

  const selectedCostCenter = costCenters.find((c) => c.id === costCenterId);
  const budget = selectedCostCenter?.annualBudget ? Number(selectedCostCenter.annualBudget) : null;
  const committed = costCenterId ? (committedByCostCenter[costCenterId] ?? 0) : 0;
  const remainingAfterThis = budget !== null ? budget - committed - total : null;

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
      }));

      const result = revision
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
          });

      if (result.error) {
        setError(result.error);
        return;
      }
      router.push("/dashboard/requisitions");
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Department</label>
          <select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="h-8 rounded-md border px-2 text-sm"
          >
            <option value="">—</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Cost center</label>
          <select
            value={costCenterId}
            onChange={(e) => setCostCenterId(e.target.value)}
            className="h-8 rounded-md border px-2 text-sm"
          >
            <option value="">—</option>
            {costCenters.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      {selectedCostCenter && budget !== null && (
        <div className="max-w-2xl rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
            <span className="text-muted-foreground">
              {selectedCostCenter.name} · annual budget {budget.toFixed(2)}
            </span>
            <span className={cn("font-medium", remainingAfterThis !== null && remainingAfterThis < 0 && "text-amber-600")}>
              {remainingAfterThis !== null && remainingAfterThis < 0
                ? `${Math.abs(remainingAfterThis).toFixed(2)} over budget`
                : `${remainingAfterThis?.toFixed(2)} left after this`}
            </span>
          </div>

          {/* A bar rather than four lines of arithmetic: the question is
              "can I afford this", and a number nobody subtracts by eye
              doesn't answer it. */}
          <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-muted">
            <span
              className="bg-muted-foreground/50"
              style={{ width: `${Math.min((committed / budget) * 100, 100)}%` }}
            />
            <span
              className={cn(
                remainingAfterThis !== null && remainingAfterThis < 0 ? "bg-amber-500" : "bg-primary",
              )}
              style={{ width: `${Math.min((total / budget) * 100, Math.max(100 - (committed / budget) * 100, 0))}%` }}
            />
          </div>

          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Already committed {committed.toFixed(2)}</span>
            <span className="text-primary">This request {total.toFixed(2)}</span>
          </div>

          {remainingAfterThis !== null && remainingAfterThis < 0 && (
            <p className="mt-2 text-xs text-amber-600">
              This would take the <Term name="cost-center" sentenceCase /> over its annual budget. You can still
              submit — it is a heads-up, not a block.
            </p>
          )}
        </div>
      )}

      {/* What submitting will actually do. The single most common question
          a first-time requester has, and the form never answered it. */}
      {preview && (
        <div
          className={cn(
            "max-w-2xl rounded-lg border p-3 text-sm",
            preview.autoApproves ? "border-warning/50 bg-warning/5" : "border-border",
          )}
        >
          {preview.autoApproves ? (
            <>
              <p className="font-medium">Nobody will review this</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                No approval rule covers a request of this value and category, so submitting approves it
                immediately and it goes straight to sourcing.
                <Info title="Why no approver?" next="An admin can add a rule from Admin › Approval rules.">
                  When no rule matches there is nobody to route the requisition to, so AWA approves it rather
                  than leaving it stuck with nobody able to act.
                </Info>
              </p>
            </>
          ) : (
            <>
              <p className="font-medium">
                When you submit, this goes to{" "}
                {preview.steps.map((step, i) => (
                  <span key={step.groupNo}>
                    {i > 0 && ", then "}
                    {step.approvers.join(" and ")}
                  </span>
                ))}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {preview.steps.map((s) => s.roleName).join(", then ")}
                {preview.ruleNames.length > 0 && ` · via “${preview.ruleNames.join("”, “")}”`}
              </p>
            </>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Justification</label>
        <textarea
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          rows={2}
          className="w-full max-w-2xl rounded-md border px-2 py-1 text-sm"
        />
      </div>

      {!revision && (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          <label className="text-xs text-muted-foreground">
            Upload a quotation, proforma, or GST invoice to fill in the line items below — or skip this and enter them manually.
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              className="text-sm"
            />
            <button
              type="button"
              disabled={isExtracting}
              onClick={extractFromDocument}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              {isExtracting ? "Extracting…" : "Extract line items"}
            </button>
            {sourceDocumentKey && <span className="text-xs text-muted-foreground">Document attached{extractedVendorName ? ` — ${extractedVendorName}` : ""}</span>}
          </div>
          {extractMessage && <p className="text-xs text-muted-foreground">{extractMessage}</p>}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Line items</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 font-normal">Item</th>
              <th className="py-2 font-normal">Category</th>
              <th className="py-2 font-normal">Type</th>
              <th className="py-2 font-normal">Qty</th>
              <th className="py-2 font-normal">UoM</th>
              <th className="py-2 font-normal">Unit price</th>
              <th className="py-2 font-normal">Line total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.key} className="border-b align-top">
                <td className="py-2 pr-2">
                  <select
                    value={line.catalogItemId ?? ""}
                    onChange={(e) => {
                      const item = catalogItems.find((i) => i.id === e.target.value);
                      updateLine(line.key, {
                        catalogItemId: e.target.value || null,
                        freeTextDescription: e.target.value ? null : line.freeTextDescription,
                        uom: item?.uom ?? line.uom,
                        categoryId: item?.categoryId ?? line.categoryId,
                      });
                    }}
                    className="h-8 w-40 rounded-md border px-2 text-sm"
                  >
                    <option value="">— custom item —</option>
                    {catalogItems.map((i) => (
                      <option key={i.id} value={i.id}>{i.name}</option>
                    ))}
                  </select>
                  {!line.catalogItemId && (
                    <input
                      value={line.freeTextDescription ?? ""}
                      onChange={(e) => updateLine(line.key, { freeTextDescription: e.target.value })}
                      placeholder="Describe the item"
                      className="mt-1 h-8 w-40 rounded-md border px-2 text-sm"
                    />
                  )}
                </td>
                <td className="py-2 pr-2">
                  <select
                    value={line.categoryId ?? ""}
                    onChange={(e) => updateLine(line.key, { categoryId: e.target.value || null })}
                    className="h-8 w-32 rounded-md border px-2 text-sm"
                  >
                    <option value="">—</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </td>
                <td className="py-2 pr-2">
                  <select
                    value={line.fulfillmentType}
                    onChange={(e) => updateLine(line.key, { fulfillmentType: e.target.value as "goods" | "service" })}
                    className="h-8 w-24 rounded-md border px-2 text-sm"
                  >
                    <option value="goods">Goods</option>
                    <option value="service">Service</option>
                  </select>
                </td>
                <td className="py-2 pr-2">
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    value={line.quantity}
                    onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                    className="h-8 w-20 rounded-md border px-2 text-sm"
                  />
                </td>
                <td className="py-2 pr-2">
                  <input
                    value={line.uom}
                    onChange={(e) => updateLine(line.key, { uom: e.target.value })}
                    className="h-8 w-16 rounded-md border px-2 text-sm"
                  />
                </td>
                <td className="py-2 pr-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={line.estimatedUnitPrice}
                    onChange={(e) => updateLine(line.key, { estimatedUnitPrice: e.target.value })}
                    className="h-8 w-24 rounded-md border px-2 text-sm"
                  />
                </td>
                <td className="py-2 pr-2 text-sm">
                  {(Number(line.quantity || 0) * Number(line.estimatedUnitPrice || 0)).toFixed(2)}
                </td>
                <td className="py-2">
                  {lines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setLines((prev) => [...prev, emptyLine()])}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            Add line
          </button>
          <p className="text-sm font-medium">Total: {total.toFixed(2)}</p>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        {!revision && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => submit(false)}
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            Save draft
            <span className="font-normal opacity-70"> · only you see it</span>
          </button>
        )}
        <button type="button" disabled={isPending} onClick={() => submit(true)} className={cn(buttonVariants())}>
          {revision ? "Resubmit for approval" : "Submit for approval"}
          {preview && !preview.autoApproves && preview.steps[0] && (
            <span className="font-normal opacity-80"> · to {preview.steps[0].approvers.join(" and ")}</span>
          )}
        </button>
      </div>
    </div>
  );
}
