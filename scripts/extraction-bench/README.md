# Invoice/quotation extraction bench

Standalone script (not wired into the app) to compare LLM providers for
extracting structured fields from invoice/quotation documents at the
requisition stage. Not part of the Next.js app's build/lint/test — its own
`package.json` and dependencies live in this folder only.

## Two-stage design

1. **Searchable PDF (has a text layer).** Detected via `pdf-parse`. No API
   call — the text is already machine-readable, so extraction should be a
   deterministic parser, not an LLM. The script includes a crude regex
   demo (`heuristicExtract`) just to show the field shape; swap it for a
   real parser once you've looked at your actual searchable-PDF samples.
2. **Scanned/image document (no text layer, or a raw PNG/JPG).** Sent to
   each configured vision API for OCR + structured extraction. This is
   where the provider comparison (cost, latency, accuracy) actually
   matters.

## Setup

```bash
cd scripts/extraction-bench
npm install
cp .env.example .env
```

Open `.env` in your editor and set `ANTHROPIC_API_KEY` (get it from the
Anthropic Console). Leave `GROQ_API_KEY` / `GEMINI_API_KEY` blank for now —
each provider is skipped automatically when its key is empty, so this
currently runs Claude Haiku 4.5 only. Add the other keys later to expand
the comparison without touching the script.

Scanned-PDF rasterization uses `pdf-parse`'s built-in `getScreenshot` —
no external tools (poppler, ghostscript, etc.) required. If rendering
fails for a given file, the script skips it with an instruction to drop
a pre-rendered PNG/JPG into `sample-docs/` instead.

## Usage

1. Drop a handful of real (or redacted) sample invoices/quotations into
   `sample-docs/` — mix of searchable PDFs and scanned/image documents.
2. Optionally add a ground-truth file per document, e.g.
   `sample-docs/invoice1.pdf.truth.json`, containing the correct scalar
   field values (see the schema in `run.mjs`'s `EXTRACTION_PROMPT`) — the
   script will score each provider's output against it.
3. Run it:

```bash
npm start
```

Output is a per-file log plus a final `console.table` summary with stage,
provider, latency, estimated cost, and accuracy (if truth files exist).

## Notes

- `sample-docs/` is gitignored — don't commit real vendor documents.
- Pricing constants in `run.mjs` are self-reported by each provider as of
  Aug 2026; override via env vars (see `.env.example`) if they've changed
  or you pick a different model.
- The vision prompt is identical across providers for a fair comparison,
  and parses raw JSON text rather than using each provider's native
  structured-output feature — good enough for a bake-off, but a
  production integration should use Claude's `output_config.format`
  (JSON schema) for guaranteed schema conformance.
