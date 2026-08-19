#!/usr/bin/env node
// Two-stage invoice/quotation extraction benchmark.
//
// Stage 1 — searchable PDF (has a text layer): extracted with pdf-parse,
// no LLM call, no cost. Field pulling here is a crude regex demo only —
// a real implementation would use a deterministic parser once the text
// is in hand, exactly because no API is needed at that point.
//
// Stage 2 — scanned/image document (no usable text layer, or a raw
// image file): sent to each configured vision API for OCR + structured
// extraction, so cost/latency/accuracy can be compared.
//
// Usage:
//   npm install
//   cp .env.example .env   # fill in whichever provider keys you have
//   npm start [path-to-sample-docs-dir]   # defaults to ./sample-docs

import fs from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { PDFParse } from "pdf-parse";

const DOCS_DIR = path.resolve(process.argv[2] || path.join(process.cwd(), "sample-docs"));
const MIN_CHARS_PER_PAGE_FOR_SEARCHABLE = 20;

// Pricing is per-provider self-reported as of Aug 2026 — verify before
// trusting the cost numbers for a real budgeting decision. Override via
// env vars if a provider changes pricing or you pick a different model.
const PROVIDERS = {
  claude: {
    enabled: Boolean(process.env.ANTHROPIC_API_KEY),
    model: process.env.CLAUDE_MODEL || "claude-haiku-4-5",
    priceInPerMTok: Number(process.env.CLAUDE_PRICE_IN ?? 1.0),
    priceOutPerMTok: Number(process.env.CLAUDE_PRICE_OUT ?? 5.0),
  },
  groq: {
    enabled: Boolean(process.env.GROQ_API_KEY),
    model: process.env.GROQ_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct",
    priceInPerMTok: Number(process.env.GROQ_PRICE_IN ?? 0.11),
    priceOutPerMTok: Number(process.env.GROQ_PRICE_OUT ?? 0.34),
  },
  gemini: {
    enabled: Boolean(process.env.GEMINI_API_KEY),
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash-lite",
    priceInPerMTok: Number(process.env.GEMINI_PRICE_IN ?? 0.10),
    priceOutPerMTok: Number(process.env.GEMINI_PRICE_OUT ?? 0.40),
  },
};

const EXTRACTION_PROMPT = `Extract fields from this invoice or vendor quotation. Respond with ONLY raw JSON (no markdown fences, no prose) in exactly this shape:
{
  "vendorName": string | null,
  "documentType": "invoice" | "quotation" | "unknown",
  "documentNumber": string | null,
  "documentDate": string | null,
  "dueOrValidUntil": string | null,
  "currency": string | null,
  "subtotal": number | null,
  "tax": number | null,
  "totalAmount": number | null,
  "lineItems": [{ "description": string, "quantity": number | null, "unitPrice": number | null, "lineTotal": number | null }]
}
Use null for anything not present or not legible. Do not invent values.`;

const SCALAR_FIELDS = [
  "vendorName",
  "documentType",
  "documentNumber",
  "documentDate",
  "dueOrValidUntil",
  "currency",
  "subtotal",
  "tax",
  "totalAmount",
];

function safeParseJson(text) {
  if (!text) return null;
  const stripped = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}

function normalize(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Math.round(value * 100) / 100;
  return String(value).trim().toLowerCase();
}

function scoreAccuracy(parsed, truth) {
  if (!parsed) return { matched: 0, total: SCALAR_FIELDS.length };
  let matched = 0;
  for (const field of SCALAR_FIELDS) {
    if (normalize(parsed[field]) === normalize(truth[field])) matched++;
  }
  return { matched, total: SCALAR_FIELDS.length };
}

async function loadTruth(file) {
  const truthPath = path.join(DOCS_DIR, `${file}.truth.json`);
  try {
    return JSON.parse(await fs.readFile(truthPath, "utf8"));
  } catch {
    return null;
  }
}

// --- Stage 1: text-layer PDFs, no API call ---

function heuristicExtract(text) {
  // (?<!sub) avoids matching "Subtotal" when looking for the grand total.
  const totalMatch = text.match(/(?<!sub)total[^\d]{0,15}([\d,]+\.\d{2})/i);
  const numberMatch = text.match(/(?:invoice|quote|quotation)\s*(?:no\.?|#|number)?\s*[:\-]?\s*([A-Za-z0-9\-/]+)/i);
  const dateMatch = text.match(/\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/);
  return {
    vendorName: null,
    documentType: "unknown",
    documentNumber: numberMatch?.[1] ?? null,
    documentDate: dateMatch?.[1] ?? null,
    dueOrValidUntil: null,
    currency: null,
    subtotal: null,
    tax: null,
    totalAmount: totalMatch ? Number(totalMatch[1].replace(/,/g, "")) : null,
    lineItems: [],
    _note: "regex demo only — replace with a deterministic parser once you have real text-layer samples",
  };
}

// --- Stage 2: vision extraction per provider ---

async function extractWithClaude(imageBase64, mediaType) {
  const client = new Anthropic();
  const start = performance.now();
  const response = await client.messages.create({
    model: PROVIDERS.claude.model,
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          { type: "text", text: EXTRACTION_PROMPT },
        ],
      },
    ],
  });
  const latencyMs = performance.now() - start;
  const textBlock = response.content.find((b) => b.type === "text");
  const parsed = safeParseJson(textBlock?.text ?? "");
  const usage = response.usage;
  const cost =
    (usage.input_tokens / 1e6) * PROVIDERS.claude.priceInPerMTok +
    (usage.output_tokens / 1e6) * PROVIDERS.claude.priceOutPerMTok;
  return { provider: "claude", model: PROVIDERS.claude.model, latencyMs, cost, usage, parsed };
}

async function extractWithGroq(imageBase64, mediaType) {
  const start = performance.now();
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: PROVIDERS.groq.model,
      temperature: 0,
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mediaType};base64,${imageBase64}` } },
            { type: "text", text: EXTRACTION_PROMPT },
          ],
        },
      ],
    }),
  });
  const latencyMs = performance.now() - start;
  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  const parsed = safeParseJson(text);
  const usage = data.usage ?? {};
  const cost =
    ((usage.prompt_tokens ?? 0) / 1e6) * PROVIDERS.groq.priceInPerMTok +
    ((usage.completion_tokens ?? 0) / 1e6) * PROVIDERS.groq.priceOutPerMTok;
  return { provider: "groq", model: PROVIDERS.groq.model, latencyMs, cost, usage, parsed };
}

async function extractWithGemini(imageBase64, mediaType) {
  const start = performance.now();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${PROVIDERS.gemini.model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ inline_data: { mime_type: mediaType, data: imageBase64 } }, { text: EXTRACTION_PROMPT }],
        },
      ],
      generationConfig: { temperature: 0 },
    }),
  });
  const latencyMs = performance.now() - start;
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  const parsed = safeParseJson(text);
  const usage = data.usageMetadata ?? {};
  const cost =
    ((usage.promptTokenCount ?? 0) / 1e6) * PROVIDERS.gemini.priceInPerMTok +
    ((usage.candidatesTokenCount ?? 0) / 1e6) * PROVIDERS.gemini.priceOutPerMTok;
  return { provider: "gemini", model: PROVIDERS.gemini.model, latencyMs, cost, usage, parsed };
}

const VISION_EXTRACTORS = { claude: extractWithClaude, groq: extractWithGroq, gemini: extractWithGemini };

// --- PDF -> PNG for the no-text-layer path ---

async function renderPdfFirstPageToPng(buf) {
  const parser = new PDFParse({ data: buf });
  try {
    const result = await parser.getScreenshot({ scale: 1.5, first: 1 });
    const page = result.pages?.[0];
    if (!page?.data) return null;
    return { base64: Buffer.from(page.data).toString("base64"), mediaType: "image/png" };
  } catch {
    return null;
  } finally {
    await parser.destroy();
  }
}

// --- Orchestration ---

async function runVisionProviders(file, image, results) {
  const truth = await loadTruth(file);
  for (const [name, extract] of Object.entries(VISION_EXTRACTORS)) {
    if (!PROVIDERS[name].enabled) continue;
    try {
      const r = await extract(image.base64, image.mediaType);
      r.file = file;
      r.stage = "vision-api";
      if (truth) r.accuracy = scoreAccuracy(r.parsed, truth);
      results.push(r);
      const acc = r.accuracy ? `  ${r.accuracy.matched}/${r.accuracy.total} fields vs truth` : "";
      console.log(`  ${name.padEnd(8)} ${Math.round(r.latencyMs)}ms  $${r.cost.toFixed(5)}${acc}`);
    } catch (err) {
      console.log(`  ${name.padEnd(8)} ERROR: ${err.message}`);
      results.push({ file, provider: name, stage: "vision-api", error: err.message });
    }
  }
}

async function main() {
  const anyEnabled = Object.values(PROVIDERS).some((p) => p.enabled);
  if (!anyEnabled) {
    console.log("No provider API keys found. Copy .env.example to .env and set at least ANTHROPIC_API_KEY.");
    return;
  }
  console.log(
    "Active providers:",
    Object.entries(PROVIDERS)
      .filter(([, p]) => p.enabled)
      .map(([name, p]) => `${name} (${p.model})`)
      .join(", "),
  );

  let files;
  try {
    files = (await fs.readdir(DOCS_DIR)).filter((f) => /\.(pdf|png|jpe?g)$/i.test(f));
  } catch {
    console.log(`Directory not found: ${DOCS_DIR}`);
    return;
  }
  if (files.length === 0) {
    console.log(`No sample documents in ${DOCS_DIR}. Drop a few invoice/quotation PDFs or images there and re-run.`);
    return;
  }

  const results = [];
  for (const file of files) {
    const filePath = path.join(DOCS_DIR, file);
    console.log(`\n=== ${file} ===`);
    const ext = path.extname(file).toLowerCase();

    if (ext === ".pdf") {
      const buf = await fs.readFile(filePath);
      const textParser = new PDFParse({ data: buf });
      const { text, total } = await textParser.getText();
      await textParser.destroy();
      const charsPerPage = text.trim().length / Math.max(total ?? 1, 1);

      if (charsPerPage >= MIN_CHARS_PER_PAGE_FOR_SEARCHABLE) {
        console.log(`  Text layer found (~${Math.round(charsPerPage)} chars/page) — no API call needed.`);
        const parsed = heuristicExtract(text);
        const truth = await loadTruth(file);
        const accuracy = truth ? scoreAccuracy(parsed, truth) : undefined;
        if (accuracy) console.log(`  text-layer  0ms  $0.00000  ${accuracy.matched}/${accuracy.total} fields vs truth`);
        results.push({ file, stage: "text-layer", provider: "none", cost: 0, latencyMs: 0, parsed, accuracy });
        continue;
      }

      console.log(`  No usable text layer (~${Math.round(charsPerPage)} chars/page) — needs vision extraction.`);
      const image = await renderPdfFirstPageToPng(buf);
      if (!image) {
        console.log(`  Skipped: couldn't rasterize this PDF. Drop a pre-rendered PNG/JPG of it into ${DOCS_DIR} instead.`);
        continue;
      }
      await runVisionProviders(file, image, results);
    } else {
      const buf = await fs.readFile(filePath);
      const mediaType = ext === ".png" ? "image/png" : "image/jpeg";
      await runVisionProviders(file, { base64: buf.toString("base64"), mediaType }, results);
    }
  }

  printSummary(results);
}

function printSummary(results) {
  if (results.length === 0) return;
  console.log("\n=== Summary ===");
  const rows = results.map((r) => ({
    file: r.file,
    stage: r.stage,
    provider: r.provider,
    latency_ms: r.error ? "—" : Math.round(r.latencyMs ?? 0),
    cost_usd: r.error ? "—" : (r.cost ?? 0).toFixed(5),
    accuracy: r.accuracy ? `${r.accuracy.matched}/${r.accuracy.total}` : "—",
    totalAmount: r.parsed?.totalAmount ?? "—",
    error: r.error ?? "",
  }));
  console.table(rows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
