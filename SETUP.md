# Setup checklist

Accounts and credentials needed before Sprint 0 (app scaffold) starts. Account creation itself has to happen on your side — sign-up, payment details, and OAuth authorization aren't something that can be done on your behalf. Everything else (config files, CI, wiring) is handled once the accounts exist.

## Accounts to create

| Service | What it's for | Plan | Status |
|---|---|---|---|
| [Vercel](https://vercel.com) | Hosts the Next.js app | Pro | ✅ Done — project `awa` created, linked to `vinit2776/awa`, CLI linked locally |
| [Supabase](https://supabase.com) | Managed Postgres, pooled connection built in | Pro | ✅ Done — project `awa` created (ap-south-1 / Mumbai), CLI linked, `DATABASE_URL` set in Vercel |
| [WorkOS](https://workos.com) | Domain-verified auth, SSO-ready | Free tier (AuthKit free to 1M MAU) | ✅ Done — `WORKOS_API_KEY` and `WORKOS_CLIENT_ID` set in Vercel |
| [Cloudflare](https://dash.cloudflare.com) | R2 object storage for documents | Pay-as-you-go | ✅ Done — bucket `awa-documents`, scoped API token, all four `R2_*` vars set in Vercel |
| [Railway](https://railway.app) | Redis + background worker, later the fraud/ML service | Hobby to start | ⬜ Not needed until phase 2 |

Supabase was picked over Neon at the §13 fork point — bundled RLS tooling won out.

## What's connected

1. **Vercel ↔ GitHub** — the Vercel GitHub App now has access to `vinit2776/awa` (it didn't by default; had to add the repo under the app's install settings), project imported, initial build succeeded (a bare 404 is expected — no app yet). Future pushes to `main` auto-deploy to production, PRs get preview deploys.
2. **Database** — Supabase project `awa` provisioned in `ap-south-1`. The pooled (Supavisor, port 6543) connection string is set as `DATABASE_URL` in Vercel across Production, Preview, and Development, encrypted. The database password itself was generated locally and never shown in chat — it's in `.supabase-db-password.local` (gitignored) if you need it for a direct `psql` connection; rotate it from the Supabase dashboard any time.
3. **WorkOS API key + client ID** — done. `WORKOS_API_KEY` and `WORKOS_CLIENT_ID` (test-mode credentials) set in Vercel across all environments.
4. **R2 credentials** — done. Bucket `awa-documents` created (Asia Pacific / Standard storage class, public access disabled), a token scoped to read/write on just that bucket (not account-wide), all four `R2_*` variables set in Vercel.

All 7 environment variables (`DATABASE_URL`, `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`) are live in Vercel across Production, Preview, and Development, encrypted. None were pasted into chat. Set anything new the same way — directly in Vercel (dashboard or `vercel env add`), never committed to the repo. `.env.example` documents the variable names without values.

**Note:** WorkOS credentials are currently test-mode (`sk_test_...`). Switch to a live/production environment in the WorkOS dashboard before this goes in front of customer #1 — test-mode keys shouldn't handle real user sign-ins.

## CI/CD

`.github/workflows/ci.yml` runs lint/typecheck/build on every PR — currently a no-op guard until Sprint 0 adds `package.json`, at which point it activates automatically. Deployment itself is handled by Vercel's GitHub integration (step 1 above), not by this workflow.
