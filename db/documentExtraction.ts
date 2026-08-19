import Anthropic from "@anthropic-ai/sdk";

export type ExtractedDocumentMeta = {
  vendorName: string | null;
  vendorAddress: string | null;
  vendorGstin: string | null;
  vendorPan: string | null;
  vendorCin: string | null;
  documentType: "quotation" | "proforma_invoice" | "gst_invoice" | "other";
  documentNumber: string | null;
  documentDate: string | null;
  subtotal: string | null;
  taxBreakdown: { label: string; rate: string | null; amount: string }[];
  taxTotal: string | null;
  grandTotal: string | null;
};

export type ExtractedLine = {
  description: string;
  quantity: string;
  uom: string;
  estimatedUnitPrice: string;
  fulfillmentType: "goods" | "service";
  matchesExistingLineIndex: number | null;
};

export type ExtractionResult = {
  lines: ExtractedLine[];
  documentMeta: ExtractedDocumentMeta;
  error?: string;
};

const EMPTY_DOCUMENT_META: ExtractedDocumentMeta = {
  vendorName: null,
  vendorAddress: null,
  vendorGstin: null,
  vendorPan: null,
  vendorCin: null,
  documentType: "other",
  documentNumber: null,
  documentDate: null,
  subtotal: null,
  taxBreakdown: [],
  taxTotal: null,
  grandTotal: null,
};

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: "record_extraction",
  description: "Records the vendor, document and line-item detail read from a quotation, proforma invoice, or GST invoice.",
  input_schema: {
    type: "object",
    properties: {
      vendorName: {
        type: ["string", "null"],
        description: "The vendor/supplier's name as printed on the document, or null if it isn't identifiable.",
      },
      vendorAddress: {
        type: ["string", "null"],
        description: "The vendor's postal address as printed, or null if absent.",
      },
      vendorGstin: {
        type: ["string", "null"],
        description: "The vendor's GSTIN (15-character GST identification number), or null if absent.",
      },
      vendorPan: {
        type: ["string", "null"],
        description: "The vendor's PAN (10-character Permanent Account Number), or null if absent.",
      },
      vendorCin: {
        type: ["string", "null"],
        description: "The vendor's CIN (Corporate Identification Number), or null if absent.",
      },
      documentType: {
        type: "string",
        enum: ["quotation", "proforma_invoice", "gst_invoice", "other"],
        description: "Best guess at what kind of document this is, from its heading and format.",
      },
      documentNumber: {
        type: ["string", "null"],
        description: "The document/invoice/quotation number as printed, or null.",
      },
      documentDate: {
        type: ["string", "null"],
        description: "The document's date as YYYY-MM-DD if printed and unambiguous, else null. Never guess a date that isn't stated.",
      },
      subtotal: {
        type: ["string", "null"],
        description: "The pre-tax subtotal as a plain numeric string, or null if not shown separately.",
      },
      taxBreakdown: {
        type: "array",
        description: "Each distinct tax line shown (e.g. CGST, SGST, IGST). Empty array if no tax is broken out.",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "e.g. \"CGST\", \"SGST\", \"IGST\"." },
            rate: { type: ["string", "null"], description: "Percentage as a plain numeric string, e.g. \"9\", or null." },
            amount: { type: "string", description: "Tax amount as a plain numeric string." },
          },
          required: ["label", "amount"],
        },
      },
      taxTotal: {
        type: ["string", "null"],
        description: "Sum of all tax shown, or null.",
      },
      grandTotal: {
        type: ["string", "null"],
        description: "The document's stated grand/final total, or null.",
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
            fulfillmentType: {
              type: "string",
              enum: ["goods", "service"],
              description: "Best guess: \"service\" for labour/AMC/consulting/subscription lines, \"goods\" otherwise.",
            },
            matchesExistingLineIndex: {
              type: ["integer", "null"],
              description:
                "If this line refers to the SAME product or service as one of the caller-supplied existingLines " +
                "— by MEANING, not wording (e.g. \"55 inch TV\" and \"55RTREHDY Toshiba 55in LED TV\" are the same " +
                "TV) — the 0-based index of that existing line. Otherwise null. Only set this when reasonably " +
                "confident; when unsure, use null rather than guessing.",
            },
          },
          required: ["description", "quantity", "uom", "estimatedUnitPrice", "fulfillmentType", "matchesExistingLineIndex"],
        },
      },
    },
    required: [
      "vendorName", "vendorAddress", "vendorGstin", "vendorPan", "vendorCin",
      "documentType", "documentNumber", "documentDate",
      "subtotal", "taxBreakdown", "taxTotal", "grandTotal",
      "lines",
    ],
  },
};

function buildPrompt(existingLines: { index: number; description: string }[]): string {
  const base =
    "This document is a vendor quotation, proforma invoice, or GST invoice. Read the vendor's name, address, " +
    "GSTIN, PAN and CIN where present; the document type, number and date; the subtotal, tax breakdown, tax " +
    "total and grand total; and every line item — description, quantity, unit of measure, per-unit price, and " +
    "whether it's goods or a service. Then call record_extraction with what you found. If a field truly isn't " +
    "stated, use null (or \"each\" for uom) rather than leaving it blank or guessing.";

  if (existingLines.length === 0) {
    return `${base} There are no already-entered line items to match against — set matchesExistingLineIndex to null for every line.`;
  }

  const list = existingLines.map((l) => `${l.index}: ${l.description}`).join("\n");
  return (
    `${base}\n\nThe requester has already typed these line items into the form:\n${list}\n\n` +
    "For each extracted line, decide whether it refers to the SAME product or service as one of these — by " +
    "meaning, not exact wording (e.g. a plain description like \"55 inch TV\" and a model-number description " +
    "like \"55RTREHDY Toshiba 55in LED TV\" can be the same item). If so, set matchesExistingLineIndex to that " +
    "entry's number. If it's a different item, or you aren't reasonably confident, set matchesExistingLineIndex " +
    "to null."
  );
}

function toDocumentBlock(bytes: Uint8Array, mimeType: string): Anthropic.Base64PDFSource | Anthropic.Base64ImageSource {
  const data = Buffer.from(bytes).toString("base64");
  if (mimeType === "application/pdf") {
    return { type: "base64", media_type: "application/pdf", data };
  }
  return { type: "base64", media_type: mimeType as "image/jpeg" | "image/png" | "image/webp", data };
}

/**
 * Pulls line items and vendor/document/tax detail out of an uploaded
 * quotation, proforma, or GST invoice via Claude's document/vision input.
 * A forced tool call (rather than parsing free text) is what makes the
 * output reliably structured — no regex or "hope it's valid JSON" parsing
 * of the model's response.
 *
 * `context.existingLines`, when given, lets the model match newly
 * extracted lines against line items the requester already typed — by
 * meaning, not text similarity, since a plain description and a vendor's
 * model-number description can refer to the same item with no shared
 * substring. The returned `matchesExistingLineIndex` is an index into
 * *this* array, not into any caller-side line list — callers must build
 * `existingLines` and resolve the returned index against the exact same
 * filtered, stably-ordered list.
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
  context?: { existingLines: { index: number; description: string }[] },
): Promise<ExtractionResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { lines: [], documentMeta: EMPTY_DOCUMENT_META, error: "Document extraction isn't configured yet — enter the line items manually below." };
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
            { type: "text", text: buildPrompt(context?.existingLines ?? []) },
          ],
        },
      ],
    });

    const toolUse = response.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
    if (!toolUse) {
      return { lines: [], documentMeta: EMPTY_DOCUMENT_META, error: "Couldn't read this document — enter the line items manually below." };
    }

    const parsed = toolUse.input as ExtractedDocumentMeta & { lines: ExtractedLine[] };
    const { lines, ...documentMeta } = parsed;

    if (!lines || lines.length === 0) {
      return { lines: [], documentMeta, error: "No line items found in this document — enter them manually below." };
    }

    return { lines, documentMeta };
  } catch {
    return { lines: [], documentMeta: EMPTY_DOCUMENT_META, error: "Document extraction failed — enter the line items manually below." };
  }
}
