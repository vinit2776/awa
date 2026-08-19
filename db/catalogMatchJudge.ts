import Anthropic from "@anthropic-ai/sdk";
import type { SimilarCatalogItem } from "./catalogMatch";

const JUDGE_TOOL: Anthropic.Tool = {
  name: "record_match",
  description: "Records which catalogue candidate, if any, is the same product or service as the typed description.",
  input_schema: {
    type: "object",
    properties: {
      matchedCandidateId: {
        type: ["string", "null"],
        description:
          "The id of the candidate that is the SAME product or service as the typed description — by meaning, " +
          "not wording — or null if none of them are, or you aren't reasonably confident. A differing part " +
          "number, model number, size, grade or specification (e.g. \"SKF 6205\" vs \"SKF 6305\", \"A4\" vs " +
          "\"A3\", grade \"OPC 43\" vs \"OPC 53\") means a DIFFERENT item even when the rest of the wording is " +
          "nearly identical — never match on those grounds. When unsure, use null rather than guessing.",
      },
    },
    required: ["matchedCandidateId"],
  },
};

function buildPrompt(description: string, candidates: SimilarCatalogItem[]): string {
  const list = candidates.map((c) => `${c.id}: ${c.name}`).join("\n");
  return (
    `A requisition line was typed as: "${description}"\n\n` +
    `These catalogue items were found by text similarity and might be the same thing:\n${list}\n\n` +
    "Decide whether the typed description refers to the SAME product or service as exactly one of these — by " +
    "meaning, not wording (e.g. a plain description and a vendor's model-number description can be the same " +
    "item). A differing part number, model number, size, grade or specification means a DIFFERENT item even " +
    "when the wording is otherwise nearly identical — for example \"SKF 6205\" is not \"SKF 6305\", \"A4\" is " +
    "not \"A3\", and grade \"OPC 43\" is not \"OPC 53\". If one candidate is confidently the same item, call " +
    "record_match with its id. Otherwise — including if you aren't reasonably confident — call record_match " +
    "with null."
  );
}

/**
 * The precision half of the recall/precision split described in
 * db/catalogMatch.ts: trigram similarity finds candidates worth
 * considering, this decides whether any of them is actually the same
 * item. It exists because that decision turns on exactly the signal
 * trigrams get backwards — a one-or-two-character part number or grade
 * difference buried in a lot of shared, similar-sounding words (see the
 * 6205/6305 example in catalogMatch.ts) — and an LLM reading for meaning
 * doesn't have that blind spot. This mirrors extractLineItemsFromDocument
 * (db/documentExtraction.ts), which already makes the same kind of
 * same-item-by-meaning judgement for extracted lines against
 * already-typed ones; a forced tool call is used here for the same
 * reason it's used there — a reliably structured answer instead of
 * parsing free text.
 *
 * Every failure path — no API key, no tool call back, a thrown request
 * error — returns null rather than throwing. Callers treat null as "no
 * suggestion", which for this feature specifically must never be papered
 * over by falling back to the top trigram candidate: an unjudged trigram
 * hit is exactly the kind of confidently-wrong suggestion this stage
 * exists to prevent (see catalogMatch.ts's 6205/6305 example). Silent and
 * absent is the safe failure mode, not "assume the closest text match is
 * right".
 */
export async function judgeCatalogMatch(
  description: string,
  candidates: SimilarCatalogItem[],
): Promise<SimilarCatalogItem | null> {
  if (candidates.length === 0) return null;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      tools: [JUDGE_TOOL],
      tool_choice: { type: "tool", name: "record_match" },
      messages: [{ role: "user", content: buildPrompt(description, candidates) }],
    });

    const toolUse = response.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
    if (!toolUse) return null;

    const { matchedCandidateId } = toolUse.input as { matchedCandidateId: string | null };
    if (!matchedCandidateId) return null;

    return candidates.find((c) => c.id === matchedCandidateId) ?? null;
  } catch {
    return null;
  }
}
