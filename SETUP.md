# Setup checklist

Accounts and credentials needed before Sprint 0 (app scaffold) starts. Account creation itself has to happen on your side — sign-up, payment details, and OAuth authorization aren't something that can be done on your behalf. Everything else (config files, CI, wiring) is handled once the accounts exist.

## Accounts to create

| Service | What it's for | Plan to pick | Deferred to |
|---|---|---|---|
| [Vercel](https://vercel.com) | Hosts the Next.js app | Pro (needed for commercial use) | Phase 0 |
| [Neon](https://neon.tech) or [Supabase](https://supabase.com) | Managed Postgres, pooled connection built in | Neon Launch, or Supabase Pro | Phase 0 |
| [WorkOS](https://workos.com) | Domain-verified auth, SSO-ready | Free tier (AuthKit free to 1M MAU) | Phase 0 |
| [Cloudflare](https://dash.cloudflare.com) | R2 object storage for documents | Pay-as-you-go | Phase 1 |
| [Railway](https://railway.app) | Redis + background worker, later the fraud/ML service | Hobby to start | Phase 2 — not needed yet |

Pick Neon or Supabase per the fork point in the scope doc §13 — Neon for branching, Supabase for bundled RLS tooling. Either works.

## What to connect once accounts exist

1. **Vercel ↔ GitHub** — install the Vercel GitHub App on `vinit2776/awa` (via the Vercel dashboard, "Import Project"). This is what gives you automatic preview deploys per PR and production deploys on merge to `main` — Vercel's own integration handles this, not a custom GitHub Actions step.
2. **Database connection string** — after creating the Neon/Supabase project, copy the **pooled** connection string (not the direct one) into Vercel's environment variables as `DATABASE_URL`. The pooled string is what makes serverless functions safe against Postgres' connection limit (§13 flags why this matters).
3. **WorkOS API key + client ID** — from the WorkOS dashboard, add as `WORKOS_API_KEY` and `WORKOS_CLIENT_ID` in Vercel's environment variables.
4. **R2 credentials** — create a bucket, generate an API token scoped to it, add `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` to Vercel.

Set all of these directly in the Vercel dashboard (or `vercel env add` from the CLI) — not pasted into chat or committed to the repo. `.env.example` in the repo root documents the variable names without values.

## CI/CD

`.github/workflows/ci.yml` runs lint/typecheck/build on every PR — currently a no-op guard until Sprint 0 adds `package.json`, at which point it activates automatically. Deployment itself is handled by Vercel's GitHub integration (step 1 above), not by this workflow.
