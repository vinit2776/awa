import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { type CurrentVendorUser, makeVendorSessionToken, resolveVendorSession } from "./vendorAuth";

export const VENDOR_SESSION_COOKIE = "vendor_session";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export async function setVendorSessionCookie(vendorUserId: string) {
  const cookieStore = await cookies();
  cookieStore.set(VENDOR_SESSION_COOKIE, makeVendorSessionToken(vendorUserId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearVendorSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(VENDOR_SESSION_COOKIE);
}

/**
 * The vendor-portal analog of db/session.ts#getCurrentUserAndTenant —
 * separate on purpose, not a variant of the same function, because a
 * vendor session has no WorkOS-issued cookie to lean on at all (see
 * db/vendorAuth.ts for why: vendors aren't a WorkOS organization member).
 */
export async function getCurrentVendorUser(): Promise<CurrentVendorUser> {
  const cookieStore = await cookies();
  const token = cookieStore.get(VENDOR_SESSION_COOKIE)?.value;
  const vendorUser = token ? await resolveVendorSession(token) : null;
  if (!vendorUser) redirect("/vendor-portal/login");
  return vendorUser;
}
