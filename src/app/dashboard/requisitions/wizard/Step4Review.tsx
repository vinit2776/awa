import type { PossibleDuplicate } from "@/db/duplicateDetection";
import { DuplicateWarningPanel } from "./DuplicateWarningPanel";

export function Step4Review({
  justification,
  setJustification,
  error,
  duplicates,
  itemName,
  duplicateReasons,
  onDuplicateReasonChange,
  onEditLines,
}: {
  justification: string;
  setJustification: (v: string) => void;
  error: string | null;
  duplicates: PossibleDuplicate[];
  itemName: (catalogItemId: string) => string | null;
  duplicateReasons: Record<string, string>;
  onDuplicateReasonChange: (duplicateOfRequisitionId: string, reason: string) => void;
  onEditLines: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-serif text-base text-foreground">Review &amp; submit</h2>
        <p className="text-sm text-muted-foreground">
          Who this goes to is in the panel on the right. Anything else needing a look is below.
        </p>
      </div>

      <DuplicateWarningPanel
        duplicates={duplicates}
        itemName={itemName}
        reasons={duplicateReasons}
        onReasonChange={onDuplicateReasonChange}
        onEditLines={onEditLines}
      />

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Justification</label>
        <textarea
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          rows={2}
          className="w-full max-w-2xl rounded-md border px-2 py-1 text-sm"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
