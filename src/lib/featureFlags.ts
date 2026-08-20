/**
 * Reads the per-tenant toggle bag already on `tenants.featureFlags`
 * (jsonb, editable today only via the platform console at
 * src/app/platform/page.tsx — no per-user or percentage rollout, just
 * an on/off switch per tenant). Nothing read this column before the
 * redesign; this is the first consumer.
 */
export function hasFlag(featureFlags: unknown, key: string): boolean {
  if (!featureFlags || typeof featureFlags !== "object") return false;
  return (featureFlags as Record<string, unknown>)[key] === true;
}

/** Gates the redesigned sidebar + home page (the two full-page-load surfaces every user hits). */
export const AWA_REDESIGN_FLAG = "awaRedesign";
