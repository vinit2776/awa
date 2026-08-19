"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ExtractedDocumentMeta } from "@/db/documentExtraction";
import {
  getRequisitionDocumentUploadUrl,
  extractRequisitionFromDocument,
  updateDraftLines,
  attachRequisitionDocument,
  type LineInput,
} from "../actions";
import { DocumentDetailsPanel } from "../wizard/DocumentDetailsPanel";
import { TaxBreakdownPanel } from "../wizard/TaxBreakdownPanel";
import { DocumentPreview } from "../wizard/DocumentPreview";
import { MatchSuggestionRow } from "../wizard/MatchSuggestionRow";
import { LineItemsTable } from "../wizard/LineItemsTable";
import { buildExistingLineRefs, type Line, type PendingMatch, type Category, type CatalogItem } from "../wizard/types";

/**
 * "The quotation will get added in time" — a draft can be created and
 * submitted with no document at all; this is where one gets attached
 * afterward. Draft-only (the detail page only renders this while
 * requisition.status === "draft"). Reuses the same extraction + semantic
 * line-matching flow as the New Requisition wizard's Document/Line items
 * steps, since a document arriving after some lines were typed by hand
 * is exactly the case that matching exists for.
 */
export function AttachDocumentPanel({
  requisitionId,
  initialLines,
  categories,
  catalogItems,
}: {
  requisitionId: string;
  initialLines: LineInput[];
  categories: Category[];
  catalogItems: CatalogItem[];
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>(() => initialLines.map((l) => ({ ...l, key: crypto.randomUUID() })));
  const [sourceDocumentKey, setSourceDocumentKey] = useState<string | null>(null);
  const [documentMeta, setDocumentMeta] = useState<ExtractedDocumentMeta | null>(null);
  const [extractMessage, setExtractMessage] = useState<string | null>(null);
  const [pendingMatches, setPendingMatches] = useState<PendingMatch[]>([]);
  const [isExtracting, startExtracting] = useTransition();
  const [isSaving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const updateLine = (key: string, patch: Partial<Line>) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key));

  const extract = () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    setExtractMessage(null);
    startExtracting(async () => {
      const presigned = await getRequisitionDocumentUploadUrl({ fileName: file.name, mimeType: file.type, fileSize: file.size });
      if (presigned.error || !presigned.uploadUrl || !presigned.key) {
        setExtractMessage(presigned.error ?? "Upload failed.");
        return;
      }
      const putResponse = await fetch(presigned.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
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
        if (newLines.length > 0) setLines((prev) => [...prev, ...newLines]);
        if (newMatches.length > 0) setPendingMatches((prev) => [...prev, ...newMatches]);
      }
    });
  };

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

  const save = () => {
    setError(null);
    startSaving(async () => {
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

      const linesResult = await updateDraftLines({ requisitionId, lines: cleanLines });
      if (linesResult.error) {
        setError(linesResult.error);
        return;
      }
      if (sourceDocumentKey && documentMeta) {
        await attachRequisitionDocument({ requisitionId, sourceDocumentKey, documentMeta });
      }
      router.refresh();
      setOpen(false);
    });
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
        Attach a quotation or invoice
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border p-4">
      <div>
        <h2 className="font-serif text-base text-foreground">Attach a document</h2>
        <p className="text-sm text-muted-foreground">
          Upload the quotation or invoice now that it&apos;s arrived — its line items will be matched against
          what&apos;s already here, by meaning rather than exact wording.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          className="text-sm"
        />
        <button type="button" disabled={isExtracting} onClick={extract} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          {isExtracting ? "Extracting…" : "Extract line items"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
          Cancel
        </button>
      </div>
      {extractMessage && <p className="text-xs text-muted-foreground">{extractMessage}</p>}

      {documentMeta && <DocumentDetailsPanel meta={documentMeta} />}
      {documentMeta && <TaxBreakdownPanel meta={documentMeta} />}

      {pendingMatches.length > 0 && (
        <div className="flex flex-col gap-2">
          {pendingMatches.map((match) => (
            <MatchSuggestionRow
              key={match.id}
              match={match}
              onUpdate={() => resolveUpdateMatch(match)}
              onKeepSeparate={() => resolveKeepSeparate(match)}
            />
          ))}
        </div>
      )}

      {sourceDocumentKey && (
        <>
          <LineItemsTable lines={lines} categories={categories} catalogItems={catalogItems} updateLine={updateLine} removeLine={removeLine} />
          <DocumentPreview sourceKey={sourceDocumentKey} />
        </>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {sourceDocumentKey && (
        <div>
          <button type="button" disabled={isSaving} onClick={save} className={cn(buttonVariants())}>
            {isSaving ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}
