import { afterEach, describe, expect, it, vi } from "vitest";
import { judgeCatalogMatch } from "../catalogMatchJudge";
import type { SimilarCatalogItem } from "../catalogMatch";

/**
 * Both branches of judgeCatalogMatch are driven explicitly here, following
 * db/__tests__/document-extraction.test.ts's pattern exactly: every test
 * stubs ANTHROPIC_API_KEY rather than inheriting whatever's in
 * .env.local (otherwise the unconfigured case only passes on a machine
 * without a key), and the configured cases stub fetch so a test run never
 * makes a real (billable) API call.
 */

const CANDIDATES: SimilarCatalogItem[] = [
  { id: "cat-6205", name: "Bearing, SKF 6205", uom: "each", categoryId: null, status: "unverified", similarity: 0.447 },
  { id: "cat-6305", name: "Bearing, SKF 6305", uom: "each", categoryId: null, status: "unverified", similarity: 0.7 },
];

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
  return [{ type: "tool_use", id: "toolu_test", name: "record_match", input }];
}

describe("judgeCatalogMatch — no API key", () => {
  it("returns null without calling the API", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await judgeCatalogMatch("Deep groove ball bearing SKF 6205-2RSH", CANDIDATES);

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("judgeCatalogMatch — no candidates", () => {
  it("returns null without calling the API, even with a key configured", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await judgeCatalogMatch("Deep groove ball bearing SKF 6205-2RSH", []);

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("judgeCatalogMatch — API key present", () => {
  it("returns the candidate the model selects", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      messagesResponse(toolUseInput({ matchedCandidateId: "cat-6205" })),
    );

    const result = await judgeCatalogMatch("Deep groove ball bearing SKF 6205-2RSH", CANDIDATES);

    expect(result?.id).toBe("cat-6205");
  });

  it("returns null when the model selects none of the candidates", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      messagesResponse(toolUseInput({ matchedCandidateId: null })),
    );

    const result = await judgeCatalogMatch("Deep groove ball bearing SKF 6205-2RSH", CANDIDATES);

    expect(result).toBeNull();
  });

  it("swallows a request failure rather than throwing at the caller", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    // 400 rather than a 5xx or a rejected promise: the SDK retries those,
    // which would make this test slow for no extra coverage.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "bad request" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await judgeCatalogMatch("Deep groove ball bearing SKF 6205-2RSH", CANDIDATES);

    expect(result).toBeNull();
  });
});
