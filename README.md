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

Known gaps carried forward deliberately, not silently: no email provider account exists yet (notifications are wired but stubbed to a console transport), no role-based UI permission gating, and the test suite isn't wired into CI (would need either a DB secret shared with the live dev database or an isolated test DB — a decision to make explicitly). Phase 2 (trust, mobile &amp; decision support — vendor portal, QR verification, bank-detail lock, fraud detection) is next per the roadmap.
