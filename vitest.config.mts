import { defineConfig } from "vitest/config";

// Runs against the live dev database (no isolated test DB exists yet) —
// every test creates its own throwaway tenant and deletes it in an
// afterAll, the same discipline used for every ad-hoc verification
// script across Sprints 1-9, just made permanent and automated here.
export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    // Agent worktrees live at .claude/worktrees/<name>/ — inside the repo,
    // each a full checkout with its own db/__tests__. Vitest's default
    // exclude doesn't cover them, so with one present `npm run test`
    // silently runs every suite twice: once here, once in the worktree.
    // That doubles the wall clock, and because both copies target the
    // same shared dev database (see the note above), the two runs create
    // and delete throwaway tenants concurrently — the exact collision
    // AGENTS.md flags as the trigger for moving to an isolated test DB.
    // A failure from that looks like a real bug and isn't one.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/.claude/worktrees/**"],
    // 30s was fine locally but too tight in CI (added Sprint 18): CI's
    // runner is further from the Supabase ap-south-1 database than
    // local dev is, and any test doing several sequential DB round
    // trips (golden-path.test.ts's whole flow, service-milestones.test.ts's
    // multi-acceptance case) can cross 30s there even though it
    // comfortably passes locally. Raised globally rather than patched
    // per test, since the next multi-round-trip test added would just
    // hit the same wall — this doesn't loosen detection of an actually
    // hung test locally, everything already finishes well under it.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
