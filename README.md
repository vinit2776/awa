# AWA — Procurement & Asset Platform

Multi-tenant requisition-to-payment platform: configurable approval engine, vendor-trust verification, and asset lifecycle tracking. Replaces a paper/WhatsApp-based procurement process.

- **Scope document**: [docs/procurement-platform-scope.html](docs/procurement-platform-scope.html) — full concept, data model, phased roadmap, tech stack, sprint plan, customer #1 pricing, and UI mockups. Open it directly in a browser.
- **Database**: [db/migrations/0001_init.sql](db/migrations/0001_init.sql) — phase 0–1 schema (tenancy, roles, approval engine, catalog, requisitions, PO, fulfillment, invoicing). Row-level security enforced at the database layer — every tenant-scoped table is isolated via `app.tenant_id`.
- **Setup**: [SETUP.md](SETUP.md) — accounts to create and environment variables needed before the app can run.

## Stack

Next.js (App Router) + TypeScript, Postgres (Neon/Supabase) with RLS, Drizzle, WorkOS auth, Cloudflare R2 storage, Railway for background workers (from phase 2). Full rationale in the scope document, §13.

## Status

Pre-build. Repo, hosting accounts, and CI/CD are being set up per [SETUP.md](SETUP.md) before Sprint 0 (app scaffold) begins.
