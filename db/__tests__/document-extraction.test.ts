import { describe, expect, it } from "vitest";
import { extractLineItemsFromDocument } from "../documentExtraction";

describe("extractLineItemsFromDocument", () => {
  it("returns an explanatory error and no lines until a provider is wired up", async () => {
    const result = await extractLineItemsFromDocument({ bytes: new Uint8Array([1, 2, 3]), mimeType: "application/pdf" });
    expect(result.lines).toEqual([]);
    expect(result.vendorName).toBeNull();
    expect(result.error).toMatch(/isn't configured/i);
    expect(result.error).toMatch(/manually/i);
  });
});
