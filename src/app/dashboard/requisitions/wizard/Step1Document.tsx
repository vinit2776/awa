"use client";

import { useRef } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Step1Document({
  isExtracting,
  extractMessage,
  onExtract,
  onSkip,
}: {
  isExtracting: boolean;
  extractMessage: string | null;
  onExtract: (file: File) => void;
  onSkip: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExtract = () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    onExtract(file);
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-serif text-base text-foreground">Document</h2>
        <p className="text-sm text-muted-foreground">
          Upload a quotation, proforma, or GST invoice and its line items, vendor detail, and tax will be read
          straight into the form. No quotation yet? Skip this — a draft can have one attached later.
        </p>
      </div>

      <div className="flex flex-col gap-2 rounded-md border p-3">
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
            onClick={handleExtract}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            {isExtracting ? "Extracting…" : "Extract line items"}
          </button>
        </div>
        {extractMessage && <p className="text-xs text-muted-foreground">{extractMessage}</p>}
      </div>

      <button type="button" onClick={onSkip} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "self-start")}>
        Skip — add a document later
      </button>
    </div>
  );
}
