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

**Phase 2 (Trust, mobile & decision support) complete** — all six §11 build items:

- Public PO verification (`/po-verify/[token]`) and a signatory registry, closing the QR/hash trust anchors left open at PO issuance
- Bank-detail lock: real AES-256-GCM encryption for account numbers, an out-of-band callback verification workflow, never a same-channel change
- Approver decision-support panel: cost-center budget standing and per-item purchase history surfaced right in the approvals inbox
- PWA v1: Web Push (wired into the existing notification triggers), an offline shell that deliberately caches only static assets — never page HTML, since a shared device replaying another tenant's cached page would be a real data leak — and per-tenant email-domain sign-in restriction
- User-provisioning UI (`/dashboard/admin/users`): invite (checked against the tenant's email-domain allow-list at invite time, not just at sign-in) and disable/re-enable — closes the gap flagged below where nothing in the app actually created the `users` row `linkUserOnSignIn` has always required. Disabling also turned out not to work until this sprint: `getCurrentUserAndTenant()` and the JIT sign-in fast path never checked `status`, so a disabled account's existing session cookie kept working regardless — fixed at both points
- Vendor portal (`/vendor-portal`): a vendor contact signs in via a passwordless magic-link email (`db/vendorAuth.ts`) — deliberately not WorkOS, since a vendor is an external company with no organization of its own in this platform, not a tenant employee — and can view and confirm POs issued to them (`purchase_orders.vendor_confirmed_at/by`), making the portal itself the source of truth per §05 rather than the emailed PDF. Handles a vendor contact's email being registered under more than one tenant (one vendor company serving several of this platform's customers) with a chooser step.
- Partial/staged delivery and vendor returns: a PO line can now be received across more than one goods-receipt event (a short shipment now, the balance later) instead of being force-closed after a single receipt — `db/fulfillment.ts#recordGoodsReceipt` sums quantity accepted across every receipt on the line and only marks it `fulfilled` once that running total meets the ordered quantity. A quality-rejected quantity can be pushed through a `vendor_return` lifecycle (`db/vendorReturns.ts`: initiated → shipped → credited → closed, one step at a time, shipment/credit-note references required at the relevant steps) right from the fulfillment page. This closes a real, previously-documented risk: `db/invoiceMatch.ts`'s 3-way match assumed exactly one receipt record per PO line and would exception (or worse, silently under-match) a delivery split across shipments — it now sums the same way `recordGoodsReceipt` does. The identical "always mark fulfilled" bug existed on the service-acceptance side too — fixed there as well.
- Milestone-based service acceptance (`db/serviceMilestones.ts`): a service PO line can define billing checkpoints (percent-of-PO or a fixed value each) instead of only accepting the whole line at once, and each milestone is accepted, rejected, or resubmitted independently — the line only reaches `fulfilled` once every defined milestone has an accepted acceptance record against it. `db/invoiceMatch.ts`'s service branch got the identical fix the goods side got in the prior sprint: it now sums accepted value across every acceptance event on the line (excluding rejected ones) instead of reading a single row, since a milestone line legitimately accumulates more than one. `service_milestones` and `vendor_returns` (above) are original phase-1 schema tables that sat unused for the whole project until these two sprints gave them logic — same pattern as `vendor_users` before the vendor portal.

Phase 3 (assets & intelligence — asset register with QR passports, catalog fuzzy/semantic dedup, fraud/anomaly detection beyond the phase-1 exact-duplicate baseline) not yet started.

Known gaps carried forward deliberately, not silently: transactional email is implemented against Resend (`db/email.ts`) but needs an account, a verified sending domain and `RESEND_API_KEY`/`EMAIL_FROM` before anything actually leaves the building — until then it logs what it would have sent, augmented by real Web Push where a device is subscribed. Notifications are still sent inside the caller's database transaction, bounded by a 5-second timeout; an outbox table is the right fix once volume justifies it. The test suite runs in CI against the shared dev database rather than an isolated test DB.
