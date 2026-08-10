"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createRequisition, reviseAndResubmitRequisition, type LineInput } from "./actions";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Department = { id: string; name: string };
type CostCenter = { id: string; name: string; annualBudget: string | null };
type Category = { id: string; name: string };
type CatalogItem = { id: string; name: string; categoryId: string | null; uom: string };

type Line = LineInput & { key: string };

const emptyLine = (): Line => ({
  key: crypto.randomUUID(),
  catalogItemId: "",
  freeTextDescription: "",
  categoryId: "",
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
        <div
          className={cn(
            "w-fit rounded-md border p-3 text-xs",
            remainingAfterThis !== null && remainingAfterThis < 0 && "border-amber-500",
          )}
        >
          <p>Annual budget: {budget.toFixed(2)}</p>
          <p>Already committed: {committed.toFixed(2)}</p>
          <p>This request: {total.toFixed(2)}</p>
          <p className="font-medium">Remaining after this: {remainingAfterThis?.toFixed(2)}</p>
          {remainingAfterThis !== null && remainingAfterThis < 0 && (
            <p className="mt-1 text-amber-600">
              This would exceed the cost center&apos;s budget. You can still submit — this is a heads-up, not a block.
            </p>
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
            Save as draft
          </button>
        )}
        <button type="button" disabled={isPending} onClick={() => submit(true)} className={cn(buttonVariants())}>
          {revision ? "Resubmit" : "Submit"}
        </button>
      </div>
    </div>
  );
}
