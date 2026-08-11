# Setup checklist

Accounts and credentials needed before Sprint 0 (app scaffold) starts. Account creation itself has to happen on your side — sign-up, payment details, and OAuth authorization aren't something that can be done on your behalf. Everything else (config files, CI, wiring) is handled once the accounts exist.

## Accounts to create

| Service | What it's for | Plan | Status |
|---|---|---|---|
| [Vercel](https://vercel.com) | Hosts the Next.js app | Pro | ✅ Done — project `awa-platform` (see note below), linked to `vinit2776/awa`, CLI linked locally |
| [Supabase](https://supabase.com) | Managed Postgres, pooled connection built in | Pro | ✅ Done — project `awa` created (ap-south-1 / Mumbai), CLI linked, `DATABASE_URL` set in Vercel |
| [WorkOS](https://workos.com) | Domain-verified auth, SSO-ready | Free tier (AuthKit free to 1M MAU) | ✅ Done — `WORKOS_API_KEY` and `WORKOS_CLIENT_ID` set in Vercel |
| [Cloudflare](https://dash.cloudflare.com) | R2 object storage for documents | Pay-as-you-go | ✅ Done — bucket `awa-documents`, scoped API token, all four `R2_*` vars set in Vercel |
| [Railway](https://railway.app) | Redis + background worker, later the fraud/ML service | Hobby to start | ⬜ Not needed until phase 2 |

Supabase was picked over Neon at the §13 fork point — bundled RLS tooling won out.

## What's connected

1. **Vercel ↔ GitHub** — the Vercel GitHub App now has access to `vinit2776/awa` (it didn't by default; had to add the repo under the app's install settings), project imported, initial build succeeded (a bare 404 is expected — no app yet). Future pushes to `main` auto-deploy to production, PRs get preview deploys.

   **Note on the project reset (2026-08-10):** the original project (`awa`, domain `awa-ebon.vercel.app`) developed a routing fault on Vercel's side — the production alias returned a platform-level `404 NOT_FOUND` before ever reaching the app (confirmed via empty runtime logs), while direct per-deployment URLs and the dashboard both reported everything as healthy. Root-caused to a broken domain-to-environment binding (removing the domain from the project's Domains registry and re-adding it as a bare alias fixed it from some network paths but not others — inconsistent across Vercel's edge, not something fixable via CLI/dashboard). Rather than wait on a support ticket, the project was recreated from scratch as **`awa-platform`** (same GitHub repo, all env vars restored from a local backup, current domain `awa-platform-tau.vercel.app`), which works cleanly. The old `awa` project was left in place (not deleted) rather than force it through a blocked destructive action — it's unused and can be deleted later from the dashboard. WorkOS's allowed redirect URIs now include both the old and new callback URLs.
2. **Database** — Supabase project `awa` provisioned in `ap-south-1`. The pooled (Supavisor, port 6543) connection string is set as `DATABASE_URL` in Vercel across Production, Preview, and Development, encrypted. The database password itself was generated locally and never shown in chat — it's in `.supabase-db-password.local` (gitignored) if you need it for a direct `psql` connection; rotate it from the Supabase dashboard any time.
3. **WorkOS API key + client ID** — done. `WORKOS_API_KEY` and `WORKOS_CLIENT_ID` (test-mode credentials) set in Vercel across all environments.
4. **R2 credentials** — done. Bucket `awa-documents` created (Asia Pacific / Standard storage class, public access disabled), a token scoped to read/write on just that bucket (not account-wide), all four `R2_*` variables set in Vercel.

All 7 environment variables (`DATABASE_URL`, `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`) are live in Vercel across Production, Preview, and Development, encrypted. None were pasted into chat. Set anything new the same way — directly in Vercel (dashboard or `vercel env add`), never committed to the repo. `.env.example` documents the variable names without values.

**Note:** WorkOS credentials are currently test-mode (`sk_test_...`). Switch to a live/production environment in the WorkOS dashboard before this goes in front of customer #1 — test-mode keys shouldn't handle real user sign-ins.

## Bank account encryption (Sprint 11 / phase 2)

`vendor_bank_accounts.account_number_enc` is AES-256-GCM encrypted via `db/crypto.ts`, keyed by `BANK_ACCOUNT_ENCRYPTION_KEY` — generated with `openssl rand -base64 32`, never a value typed or reused. Set independently per environment (Production/Preview/Development each got their own key, not a shared one) via `vercel env add`, never pasted into chat. `account_number_last4` is stored in cleartext alongside the encrypted value specifically so the UI never needs to decrypt just to render a masked display — nothing in the app currently decrypts the full number at all; that capability exists in `db/crypto.ts` for whenever real payment execution is built, but isn't wired into any UI yet.

**Rotating this key makes every previously-encrypted account number permanently undecryptable** — treat it like a database credential, not a config toggle.

## CI/CD

`.github/workflows/ci.yml` runs lint/typecheck/build on every PR and is live now that Sprint 0 added `package.json`. Deployment itself is handled by Vercel's GitHub integration (step 1 above), not by this workflow.

## Database roles (added in Sprint 1)

Two Postgres roles, two connection strings — this distinction matters, don't collapse it:

- **`app_runtime`** (`DATABASE_URL`) — the role the app actually queries as. RLS applies to it in full. This is what `db/client.ts` uses, and it's what every feature sprint from here on should use, via `db/withTenant.ts`.
- **postgres, the table owner** (`DATABASE_URL_MIGRATIONS`) — RLS does **not** apply to table owners in Postgres, by design. Used only for running migrations (`supabase db push`, `drizzle.config.ts`) and the one legitimate bootstrap case where RLS scope genuinely can't apply yet: resolving which tenant a signing-in user belongs to, in `db/tenant.ts` and `db/session.ts` (via `db/adminClient.ts`). Nothing else should import `adminClient.ts`.

This split exists because the first version of `DATABASE_URL` pointed at the owner role — meaning RLS was silently bypassed on every query, including the phase-0 smoke tests. Verified fixed with a live test proving an unscoped `app_runtime` query returns nothing even when matching rows exist, and `withTenant` returns exactly the right rows for the right tenant and nothing for the wrong one.

`app_runtime`'s password, like the Supabase database password, was generated locally and never shown in chat — see `.app-runtime-password.local` (gitignored) if you need direct `psql` access as that role.

## Auth flow (Sprint 1)

WorkOS AuthKit is wired (`src/middleware.ts`, `src/app/callback/route.ts`). There's no self-serve signup yet — onboarding a customer is two deliberate steps, not something that happens automatically from a sign-in attempt:

1. A platform admin links a `tenants` row to a WorkOS Organization (`tenants.workos_organization_id`).
2. A platform admin (or tenant admin, once that UI exists) pre-provisions a `users` row for each person, status `invited`, matched by email within that tenant.

The first time that person signs in via WorkOS, `db/tenant.ts`'s `linkUserOnSignIn` matches their WorkOS organization to the tenant, matches their email to the pending `users` row, records their `workos_user_id`, and flips status to `active`. Signing in with an email that has no matching pre-provisioned row fails loudly (a real error, not a silent bounce) — that's intentional; it means an admin step is missing, not a bug to paper over.
