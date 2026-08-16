<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Go-live policy

## Shipping changes

Every change — feature, fix, chore — goes through a branch and a PR into `main`, not a direct push. This replaces the direct-to-main pattern used for Sprints 0–16; from here on:

1. `git checkout main && git pull && git checkout -b <type>/<desc>` — types: `feat`, `fix`, `chore`, `refactor`, `docs`, matching the conventional-commit style already used in this repo's history.
2. Open a PR. CI (`.github/workflows/ci.yml`) must pass — lint, typecheck, build, **and test** — before merge. Vercel gives every PR a preview deploy automatically; use it to click through the change before merging.
3. Merge to `main` triggers Vercel's production auto-deploy (`awa-platform-tau.vercel.app`) — there is no separate deploy step.
4. Delete the branch after merge.

**Branch protection is deliberately NOT enforced yet — read this before assuming it's live.** Both classic branch protection and Rulesets return `403: Upgrade to GitHub Pro or make this repository public` on this repo (private, free plan) — confirmed via the GitHub API, not just undocumented. Until the plan changes or the repo goes public, nothing stops a direct push to `main` or an unreviewed merge; this section is a norm the humans (and agents) working in this repo agree to follow, not something GitHub is currently enforcing. Don't treat "PR merged" or "CI green" as proof a change went through review until this is actually turned on. Revisit by upgrading to GitHub Pro/Team or making the repo public — both are deliberate, human calls, not something to flip silently.

## CI gates (`.github/workflows/ci.yml`)

- lint, typecheck, build — already wired.
- test (`npm run test`, vitest) — runs `db/__tests__/rls-isolation.test.ts` and `golden-path.test.ts` against the same dev Supabase database the test suite already targets locally (see `vitest.config.ts`); no isolated test DB exists yet. Each test creates and cleans up its own throwaway tenant, the same discipline as every manual verification script since Sprint 1 — just automated now. Needs `DATABASE_URL` and `DATABASE_URL_MIGRATIONS` set as GitHub Actions repo secrets (same values as the dev/local `.env.local`, not the Vercel Production env vars) — set via the repo Settings → Secrets UI or `gh secret set`, never pasted into chat, same discipline as every other secret in this project (see `SETUP.md`).
- Revisit the shared-dev-DB choice once the dev database holds anything resembling real data, or once concurrent CI runs start colliding on tenant cleanup — switch to an isolated test DB (new Supabase project) at that point rather than before.

## Launch readiness (one-time, before customer #1)

Carried forward from gaps already flagged in `README.md` / `SETUP.md` — not a recurring gate, a checklist to clear once:

- [ ] Switch WorkOS credentials from test-mode (`sk_test_...`) to live/production in the WorkOS dashboard (`SETUP.md`).
- [ ] Create a Resend account, verify a sending domain, and set `RESEND_API_KEY` / `EMAIL_FROM` in Vercel. The
      integration is built (`db/email.ts`, used by `db/notifications.ts` and `db/vendorAuth.ts`) — without those
      two variables it logs what it would have sent and carries on, so this is now an account task rather than a
      code task. Deliberately left unset in CI: the suites exercise the notification paths against fixture
      addresses.
- [ ] Decide role-based UI permission gating (flagged as a known gap in `README.md`).
- [ ] Turn on GitHub branch protection on `main` (PR + passing CI required) per the shipping policy above — blocked on GitHub Pro/Team (or making the repo public); currently unavailable on the private free-plan repo.
- [ ] Confirm `db/__tests__/rls-isolation.test.ts` is green — this is the test that actually proves tenant isolation holds; treat a failure here as a launch blocker, not a flaky test to skip.
