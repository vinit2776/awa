import Anthropic from "@anthropic-ai/sdk";

export type ExtractedLine = {
  description: string;
  quantity: string;
  uom: string;
  estimatedUnitPrice: string;
};

export type ExtractionResult = {
  lines: ExtractedLine[];
  vendorName: string | null;
  error?: string;
};

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: "record_extraction",
  description: "Records the vendor name and line items read from a quotation, proforma invoice, or GST invoice.",
  input_schema: {
    type: "object",
    properties: {
      vendorName: {
        type: ["string", "null"],
        description: "The vendor/supplier's name as printed on the document, or null if it isn't identifiable.",
      },
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string", description: "The item or service description." },
            quantity: { type: "string", description: "Numeric quantity as a plain string, e.g. \"5\" or \"2.5\"." },
            uom: { type: "string", description: "Unit of measure, e.g. \"each\", \"kg\", \"box\" — default to \"each\" if not stated." },
            estimatedUnitPrice: { type: "string", description: "Per-unit price as a plain numeric string (no currency symbol), e.g. \"120.00\"." },
          },
          required: ["description", "quantity", "uom", "estimatedUnitPrice"],
        },
      },
    },
    required: ["vendorName", "lines"],
  },
};

const EXTRACTION_PROMPT =
  "This document is a vendor quotation, proforma invoice, or GST invoice. Read every line item — description, " +
  "quantity, unit of measure, and per-unit price — and the vendor's name, then call record_extraction with what " +
  "you found. If a field truly isn't stated (e.g. no explicit unit of measure), use a sensible default " +
  "(\"each\") rather than leaving it blank.";

function toDocumentBlock(bytes: Uint8Array, mimeType: string): Anthropic.Base64PDFSource | Anthropic.Base64ImageSource {
  const data = Buffer.from(bytes).toString("base64");
  if (mimeType === "application/pdf") {
    return { type: "base64", media_type: "application/pdf", data };
  }
  return { type: "base64", media_type: mimeType as "image/jpeg" | "image/png" | "image/webp", data };
}

/**
 * Pulls line items (and, where available, the vendor name) out of an
 * uploaded quotation, proforma, or GST invoice via Claude's document/
 * vision input. A forced tool call (rather than parsing free text) is
 * what makes the output reliably structured — no regex or "hope it's
 * valid JSON" parsing of the model's response.
 *
 * Every failure path (no API key, no tool call back, no lines found,
 * a thrown request error) returns a normal ExtractionResult with
 * `error` set rather than throwing — callers already treat a returned
 * error the same as "nothing extracted, user fills it in by hand",
 * and that fallback has to keep working whether extraction is
 * unconfigured, temporarily down, or just couldn't read this
 * particular scan.
 */
export async function extractLineItemsFromDocument(
  file: { bytes: Uint8Array; mimeType: string },
): Promise<ExtractionResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { lines: [], vendorName: null, error: "Document extraction isn't configured yet — enter the line items manually below." };
  }

  try {
    const client = new Anthropic({ apiKey });
    const source = toDocumentBlock(file.bytes, file.mimeType);
    const response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 4096,
      tools: [EXTRACTION_TOOL],
      tool_choice: { type: "tool", name: "record_extraction" },
      messages: [
        {
          role: "user",
          content: [
            source.media_type === "application/pdf"
              ? { type: "document", source }
              : { type: "image", source },
            { type: "text", text: EXTRACTION_PROMPT },
          ],
        },
      ],
    });

    const toolUse = response.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
    if (!toolUse) {
      return { lines: [], vendorName: null, error: "Couldn't read this document — enter the line items manually below." };
    }

    const parsed = toolUse.input as { vendorName: string | null; lines: ExtractedLine[] };
    if (!parsed.lines || parsed.lines.length === 0) {
      return { lines: [], vendorName: parsed.vendorName ?? null, error: "No line items found in this document — enter them manually below." };
    }

    return { lines: parsed.lines, vendorName: parsed.vendorName ?? null };
  } catch {
    return { lines: [], vendorName: null, error: "Document extraction failed — enter the line items manually below." };
  }
}
