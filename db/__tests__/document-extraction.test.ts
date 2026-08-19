import { afterEach, describe, expect, it, vi } from "vitest";
import { extractLineItemsFromDocument } from "../documentExtraction";

/**
 * Both branches of extractLineItemsFromDocument are driven explicitly here.
 *
 * ANTHROPIC_API_KEY decides which one runs, so every test stubs it rather
 * than inheriting whatever the developer happens to have in .env.local —
 * otherwise the unconfigured case passes in CI (no key) and fails on any
 * machine that has one, where the 3-byte fake PDF below reaches the real
 * API instead. The configured cases stub fetch for the same reason: a test
 * run must never make a real (billable) extraction call.
 */

const FAKE_PDF = { bytes: new Uint8Array([1, 2, 3]), mimeType: "application/pdf" };

const FULL_DOCUMENT_META = {
  vendorName: "Acme Supplies",
  vendorAddress: "1 Industrial Estate, Pune",
  vendorGstin: "27AAAAA0000A1Z5",
  vendorPan: "AAAAA0000A",
  vendorCin: "U12345MH2000PTC000001",
  documentType: "gst_invoice" as const,
  documentNumber: "INV-100",
  documentDate: "2026-08-01",
  subtotal: "500.00",
  taxBreakdown: [{ label: "CGST", rate: "9", amount: "45.00" }, { label: "SGST", rate: "9", amount: "45.00" }],
  taxTotal: "90.00",
  grandTotal: "590.00",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function messagesResponse(content: unknown[]): Response {
  return new Response(
    JSON.stringify({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5",
      content,
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function toolUseInput(input: unknown) {
  return [{ type: "tool_use", id: "toolu_test", name: "record_extraction", input }];
}

/** Pulls the text prompt sent to the API out of a mocked fetch call's request body. */
function promptFromFetchCall(fetchSpy: ReturnType<typeof vi.spyOn>): string {
  const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
  const body = JSON.parse(init.body as string);
  const textBlock = body.messages[0].content.find((b: { type: string }) => b.type === "text");
  return textBlock.text;
}

describe("extractLineItemsFromDocument — no API key", () => {
  it("returns an explanatory error and no lines, without calling the API", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await extractLineItemsFromDocument(FAKE_PDF);

    expect(result.lines).toEqual([]);
    expect(result.documentMeta.vendorName).toBeNull();
    expect(result.documentMeta.documentType).toBe("other");
    expect(result.error).toMatch(/isn't configured/i);
    expect(result.error).toMatch(/manually/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("extractLineItemsFromDocument — API key present", () => {
  it("returns the lines and full document/vendor/tax detail from the forced tool call", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      messagesResponse(
        toolUseInput({
          ...FULL_DOCUMENT_META,
          lines: [
            { description: "M8 bolt", quantity: "50", uom: "each", estimatedUnitPrice: "12.50", fulfillmentType: "goods", matchesExistingLineIndex: null },
            { description: "Grease", quantity: "2", uom: "kg", estimatedUnitPrice: "340.00", fulfillmentType: "goods", matchesExistingLineIndex: null },
          ],
        }),
      ),
    );

    const result = await extractLineItemsFromDocument(FAKE_PDF);

    expect(result.error).toBeUndefined();
    expect(result.documentMeta).toEqual(FULL_DOCUMENT_META);
    expect(result.lines).toEqual([
      { description: "M8 bolt", quantity: "50", uom: "each", estimatedUnitPrice: "12.50", fulfillmentType: "goods", matchesExistingLineIndex: null },
      { description: "Grease", quantity: "2", uom: "kg", estimatedUnitPrice: "340.00", fulfillmentType: "goods", matchesExistingLineIndex: null },
    ]);
  });

  it("falls back to manual entry when the document yields no lines", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      messagesResponse(toolUseInput({ ...FULL_DOCUMENT_META, lines: [] })),
    );

    const result = await extractLineItemsFromDocument(FAKE_PDF);

    expect(result.lines).toEqual([]);
    // The vendor/document detail is still worth keeping — it prefills the
    // form even though the line items have to be typed in.
    expect(result.documentMeta.vendorName).toBe("Acme Supplies");
    expect(result.error).toMatch(/no line items found/i);
    expect(result.error).toMatch(/manually/i);
  });

  it("swallows a request failure rather than throwing at the caller", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    // 400 rather than a 5xx or a rejected promise: the SDK retries those,
    // which would make this test slow for no extra coverage.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "could not process pdf" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await extractLineItemsFromDocument(FAKE_PDF);

    expect(result.lines).toEqual([]);
    expect(result.documentMeta.vendorName).toBeNull();
    expect(result.error).toMatch(/extraction failed/i);
    expect(result.error).toMatch(/manually/i);
  });

  it("returns a matched line index when the model links a line to an existing one", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      messagesResponse(
        toolUseInput({
          ...FULL_DOCUMENT_META,
          lines: [
            { description: "55RTREHDY Toshiba 55in LED TV", quantity: "1", uom: "each", estimatedUnitPrice: "45000.00", fulfillmentType: "goods", matchesExistingLineIndex: 0 },
          ],
        }),
      ),
    );

    const result = await extractLineItemsFromDocument(FAKE_PDF, { existingLines: [{ index: 0, description: "55 inch TV" }] });

    expect(result.lines[0].matchesExistingLineIndex).toBe(0);
  });

  it("includes the caller's existing lines in the prompt, by meaning not wording", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      messagesResponse(toolUseInput({ ...FULL_DOCUMENT_META, lines: [] })),
    );

    await extractLineItemsFromDocument(FAKE_PDF, { existingLines: [{ index: 0, description: "55 inch TV" }] });

    const prompt = promptFromFetchCall(fetchSpy);
    expect(prompt).toContain("0: 55 inch TV");
    expect(prompt).toMatch(/by meaning/i);
  });

  it("tells the model there's nothing to match against when no existing lines are given", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      messagesResponse(toolUseInput({ ...FULL_DOCUMENT_META, lines: [] })),
    );

    await extractLineItemsFromDocument(FAKE_PDF);

    const prompt = promptFromFetchCall(fetchSpy);
    expect(prompt).toMatch(/no already-entered line items/i);
  });
});
