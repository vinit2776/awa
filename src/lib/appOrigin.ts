import { headers } from "next/headers";

// Same header pair src/app/vendor-portal/login/actions.ts already uses to
// build absolute links — there's no configured "app URL" env var, so the
// request itself is the only source of truth for which host is live.
export async function getAppOrigin(): Promise<string> {
  const hdrs = await headers();
  const proto = hdrs.get("x-forwarded-proto") ?? "http";
  const host = hdrs.get("host");
  return `${proto}://${host}`;
}
