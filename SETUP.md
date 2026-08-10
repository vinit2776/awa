# Setup checklist

Accounts and credentials needed before Sprint 0 (app scaffold) starts. Account creation itself has to happen on your side — sign-up, payment details, and OAuth authorization aren't something that can be done on your behalf. Everything else (config files, CI, wiring) is handled once the accounts exist.

## Accounts to create

| Service | What it's for | Plan | Status |
|---|---|---|---|
| [Vercel](https://vercel.com) | Hosts the Next.js app | Pro | ✅ Done — project `awa` created, linked to `vinit2776/awa`, CLI linked locally |
| [Supabase](https://supabase.com) | Managed Postgres, pooled connection built in | Pro | ✅ Done — project `awa` created (ap-south-1 / Mumbai), CLI linked, `DATABASE_URL` set in Vercel |
| [WorkOS](https://workos.com) | Domain-verified auth, SSO-ready | Free tier (AuthKit free to 1M MAU) | ⬜ Not started |
| [Cloudflare](https://dash.cloudflare.com) | R2 object storage for documents | Pay-as-you-go | ⬜ Not started — phase 1, not urgent |
| [Railway](https://railway.app) | Redis + background worker, later the fraud/ML service | Hobby to start | ⬜ Not needed until phase 2 |

Supabase was picked over Neon at the §13 fork point — bundled RLS tooling won out.

## What's connected

1. **Vercel ↔ GitHub** — the Vercel GitHub App now has access to `vinit2776/awa` (it didn't by default; had to add the repo under the app's install settings), project imported, initial build succeeded (a bare 404 is expected — no app yet). Future pushes to `main` auto-deploy to production, PRs get preview deploys.
2. **Database** — Supabase project `awa` provisioned in `ap-south-1`. The pooled (Supavisor, port 6543) connection string is set as `DATABASE_URL` in Vercel across Production, Preview, and Development, encrypted. The database password itself was generated locally and never shown in chat — it's in `.supabase-db-password.local` (gitignored) if you need it for a direct `psql` connection; rotate it from the Supabase dashboard any time.
3. **WorkOS API key + client ID** — still to do. From the WorkOS dashboard, add as `WORKOS_API_KEY` and `WORKOS_CLIENT_ID` in Vercel's environment variables.
4. **R2 credentials** — still to do. Create a bucket, generate an API token scoped to it, add `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` to Vercel.

Set new values directly in the Vercel dashboard (or `vercel env add` from the CLI) — not pasted into chat or committed to the repo. `.env.example` in the repo root documents the variable names without values.

## CI/CD

`.github/workflows/ci.yml` runs lint/typecheck/build on every PR — currently a no-op guard until Sprint 0 adds `package.json`, at which point it activates automatically. Deployment itself is handled by Vercel's GitHub integration (step 1 above), not by this workflow.
