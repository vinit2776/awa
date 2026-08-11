import { defineConfig } from "vitest/config";

// Runs against the live dev database (no isolated test DB exists yet) —
// every test creates its own throwaway tenant and deletes it in an
// afterAll, the same discipline used for every ad-hoc verification
// script across Sprints 1-9, just made permanent and automated here.
export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
