import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ExtractedDocumentMeta } from "@/db/documentExtraction";
import { DocumentDetailsPanel } from "./DocumentDetailsPanel";
import { TaxBreakdownPanel } from "./TaxBreakdownPanel";
import { DocumentPreview } from "./DocumentPreview";
import { MatchSuggestionRow } from "./MatchSuggestionRow";
import { LineItemsTable } from "./LineItemsTable";
import type { Line, Category, CatalogItem, PendingMatch } from "./types";

export function Step3LineItems({
  lines,
  categories,
  catalogItems,
  updateLine,
  removeLine,
  addLine,
  total,
  documentMeta,
  sourceDocumentKey,
  pendingMatches,
  onUpdateMatch,
  onKeepMatchSeparate,
}: {
  lines: Line[];
  categories: Category[];
  catalogItems: CatalogItem[];
  updateLine: (key: string, patch: Partial<Line>) => void;
  removeLine: (key: string) => void;
  addLine: () => void;
  total: number;
  documentMeta: ExtractedDocumentMeta | null;
  sourceDocumentKey: string | null;
  pendingMatches: PendingMatch[];
  onUpdateMatch: (match: PendingMatch) => void;
  onKeepMatchSeparate: (match: PendingMatch) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-base text-foreground">Line items</h2>
          <p className="text-sm text-muted-foreground">What this requisition is for.</p>
        </div>
        {sourceDocumentKey && <Badge variant="info">Extracted from document</Badge>}
      </div>

      {documentMeta && <DocumentDetailsPanel meta={documentMeta} />}
      {documentMeta && <TaxBreakdownPanel meta={documentMeta} />}

      {pendingMatches.length > 0 && (
        <div className="flex flex-col gap-2">
          {pendingMatches.map((match) => (
            <MatchSuggestionRow
              key={match.id}
              match={match}
              onUpdate={() => onUpdateMatch(match)}
              onKeepSeparate={() => onKeepMatchSeparate(match)}
            />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3">
        {/* Scrolls within itself at a viewport too narrow for the sidebar
            plus every fixed-width input in a row — without this boundary
            the overflow used to bubble up to DashboardShell's <main>
            (fixed now too, but belt-and-suspenders) and drag the "Add
            line" / total row, and the step nav above, out to the right
            along with it. */}
        <div className="overflow-x-auto">
          <LineItemsTable
            lines={lines}
            categories={categories}
            catalogItems={catalogItems}
            updateLine={updateLine}
            removeLine={removeLine}
          />
        </div>

        <div className="flex items-center justify-between">
          <button type="button" onClick={addLine} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            Add line
          </button>
          <p className="text-sm font-medium">Total: {total.toFixed(2)}</p>
        </div>
      </div>

      {sourceDocumentKey && <DocumentPreview sourceKey={sourceDocumentKey} />}
    </div>
  );
}
