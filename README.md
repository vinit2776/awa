# AWA — Procurement & Asset Platform

Multi-tenant requisition-to-payment platform: configurable approval engine, vendor-trust verification, and asset lifecycle tracking. Replaces a paper/WhatsApp-based procurement process.

- **Scope document**: [docs/procurement-platform-scope.html](docs/procurement-platform-scope.html) — full concept, data model, phased roadmap, tech stack, sprint plan, customer #1 pricing, and UI mockups. Open it directly in a browser.
- **Database**: [db/migrations/0001_init.sql](db/migrations/0001_init.sql) — phase 0–1 schema (tenancy, roles, approval engine, catalog, requisitions, PO, fulfillment, invoicing). Row-level security enforced at the database layer — every tenant-scoped table is isolated via `app.tenant_id`.
- **Setup**: [SETUP.md](SETUP.md) — accounts to create and environment variables needed before the app can run.

## Stack

Next.js (App Router) + TypeScript, Postgres (Neon/Supabase) with RLS, Drizzle, WorkOS auth, Cloudflare R2 storage, Railway for background workers (from phase 2). Full rationale in the scope document, §13.

## Status

**Phase 1 (Core procurement MVP) complete** — Sprints 0–10 per the scope doc's §14 sprint plan:

- Tenancy, auth (WorkOS AuthKit, JIT-linked, no self-serve signup), RLS enforced on a dedicated `app_runtime` role — verified via a live isolation test suite (`db/__tests__/rls-isolation.test.ts`), not just assumed
- Roles, platform admin console, catalog with trigram-fuzzy dedup hints
- Requisition creation with budget display, a rule-matrix approval engine (additive/exclusive combination, ad-hoc approver addition), reject/revise/resubmit
- RFQ → vendor quotations → PO issuance with a document hash, QR token, and a real PDF (`pdf-lib` + `qrcode`)
- Goods receipt and service acceptance, including the segregation-of-duties DB trigger wired into the UI
- Invoice capture, exact 3-way match against receipt/acceptance records, an exception queue, and a payment release queue
- A coordinator-facing lifecycle tracker (`/dashboard/lifecycle`) and a golden-path integration test (`db/__tests__/golden-path.test.ts`) walking one requisition through every stage

**Phase 2 (Trust, mobile & decision support) in progress:**

- Public PO verification (`/po-verify/[token]`) and a signatory registry, closing the QR/hash trust anchors left open at PO issuance
- Bank-detail lock: real AES-256-GCM encryption for account numbers, an out-of-band callback verification workflow, never a same-channel change
- Approver decision-support panel: cost-center budget standing and per-item purchase history surfaced right in the approvals inbox
- PWA v1: Web Push (wired into the existing notification triggers), an offline shell that deliberately caches only static assets — never page HTML, since a shared device replaying another tenant's cached page would be a real data leak — and per-tenant email-domain sign-in restriction

Still to come in phase 2: the full vendor portal (needs an explicit decision on an external-user auth model, distinct from WorkOS's organization-based internal auth), partial delivery / quality rejection / vendor returns, and milestone-based service acceptance — both of the latter two touch the "one fulfillment record per PO line" assumption the invoice-matching engine relies on, so they're a bigger unit of work than what's shipped so far.

Known gaps carried forward deliberately, not silently: no email provider account exists yet (notifications are wired but stubbed to a console transport, augmented by real Web Push where a device is subscribed), no role-based UI permission gating, no UI to actually provision/invite a new user (found while building domain restriction — `linkUserOnSignIn` requires a pre-existing `users` row, but nothing in the app creates one yet outside a direct script), and the test suite isn't wired into CI (would need either a DB secret shared with the live dev database or an isolated test DB — a decision to make explicitly).
