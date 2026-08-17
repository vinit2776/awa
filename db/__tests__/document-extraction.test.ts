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

describe("extractLineItemsFromDocument — no API key", () => {
  it("returns an explanatory error and no lines, without calling the API", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await extractLineItemsFromDocument(FAKE_PDF);

    expect(result.lines).toEqual([]);
    expect(result.vendorName).toBeNull();
    expect(result.error).toMatch(/isn't configured/i);
    expect(result.error).toMatch(/manually/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("extractLineItemsFromDocument — API key present", () => {
  it("returns the lines and vendor name from the forced tool call", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      messagesResponse([
        {
          type: "tool_use",
          id: "toolu_test",
          name: "record_extraction",
          input: {
            vendorName: "Acme Supplies",
            lines: [
              { description: "M8 bolt", quantity: "50", uom: "each", estimatedUnitPrice: "12.50" },
              { description: "Grease", quantity: "2", uom: "kg", estimatedUnitPrice: "340.00" },
            ],
          },
        },
      ]),
    );

    const result = await extractLineItemsFromDocument(FAKE_PDF);

    expect(result.error).toBeUndefined();
    expect(result.vendorName).toBe("Acme Supplies");
    expect(result.lines).toEqual([
      { description: "M8 bolt", quantity: "50", uom: "each", estimatedUnitPrice: "12.50" },
      { description: "Grease", quantity: "2", uom: "kg", estimatedUnitPrice: "340.00" },
    ]);
  });

  it("falls back to manual entry when the document yields no lines", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      messagesResponse([
        {
          type: "tool_use",
          id: "toolu_test",
          name: "record_extraction",
          input: { vendorName: "Acme Supplies", lines: [] },
        },
      ]),
    );

    const result = await extractLineItemsFromDocument(FAKE_PDF);

    expect(result.lines).toEqual([]);
    // The vendor name is still worth keeping — it prefills the form even
    // though the line items have to be typed in.
    expect(result.vendorName).toBe("Acme Supplies");
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
    expect(result.vendorName).toBeNull();
    expect(result.error).toMatch(/extraction failed/i);
    expect(result.error).toMatch(/manually/i);
  });
});
