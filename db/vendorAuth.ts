import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { adminDb } from "./adminClient";
import { tenants, vendors, vendorUsers } from "./schema";
import { logEmailResult, sendEmail } from "./email";

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function getSecret(): string {
  const secret = process.env.VENDOR_SESSION_SECRET;
  if (!secret) throw new Error("VENDOR_SESSION_SECRET is not set");
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

/**
 * Self-verifying signed token, not a server-side session table — same
 * shape as the qr_token pattern in db/poVerify.ts (the token itself is
 * the credential), just HMAC-signed instead of random-and-looked-up,
 * because a magic link and a session cookie both need to carry a claim
 * (email, or vendor_user id) plus an expiry, not just prove uniqueness.
 */
function makeToken(payload: string, ttlMs: number): string {
  const expiresAt = Date.now() + ttlMs;
  const body = `${payload}.${expiresAt}`;
  return `${Buffer.from(body, "utf8").toString("base64url")}.${sign(body)}`;
}

function verifyToken(token: string): string | null {
  const [bodyB64, signature] = token.split(".");
  if (!bodyB64 || !signature) return null;
  const body = Buffer.from(bodyB64, "base64url").toString("utf8");
  const expected = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const lastDot = body.lastIndexOf(".");
  const payload = body.slice(0, lastDot);
  const expiresAt = Number(body.slice(lastDot + 1));
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;
  return payload;
}

export function makeMagicLinkToken(email: string): string {
  return makeToken(email.trim().toLowerCase(), MAGIC_LINK_TTL_MS);
}

export function verifyMagicLinkToken(token: string): string | null {
  return verifyToken(token);
}

/**
 * Silently no-ops on an email with no vendor_users match at all, same as any
 * login-by-email flow should: telling an unauthenticated caller "no account
 * with that email" is a user-enumeration leak.
 *
 * Delivery goes through db/email.ts, which logs the link instead of sending
 * when no provider is configured — so the portal stays usable locally without
 * an account, exactly as it did before.
 *
 * The result is deliberately not returned to the caller. The sign-in page must
 * render the same "check your inbox" response whether or not the address
 * matched and whether or not the send succeeded; surfacing a delivery failure
 * here would reintroduce the enumeration leak the early return avoids.
 */
export async function sendVendorMagicLink(email: string, baseUrl: string) {
  const matches = await findVendorLoginMatches(email);
  if (matches.length === 0) return;

  const token = makeMagicLinkToken(email);
  const link = `${baseUrl}/vendor-portal/verify/${token}`;
  const body = [
    "Sign in to the AWA vendor portal using the link below. It expires in 15 minutes.",
    "",
    link,
    "",
    "If you didn't request this, you can ignore this email.",
  ].join("\n");

  const result = await sendEmail({ to: email, subject: "Your AWA vendor portal sign-in link", text: body });
  logEmailResult("vendor-magic-link", email, "Your AWA vendor portal sign-in link", body, result);
}

export function makeVendorSessionToken(vendorUserId: string): string {
  return makeToken(vendorUserId, SESSION_TTL_MS);
}

export function verifyVendorSessionToken(token: string): string | null {
  return verifyToken(token);
}

export type VendorLoginMatch = {
  vendorUserId: string;
  vendorId: string;
  vendorName: string;
  tenantId: string;
  tenantName: string;
};

/**
 * Same adminDb-bypass shape as db/tenant.ts#linkUserOnSignIn and
 * db/poVerify.ts — there is no tenant session to scope a withTenant()
 * call to yet, because resolving one is the whole point of this lookup.
 * A vendor can legitimately have a vendor_users row (same email) under
 * more than one tenant — vendor_users is unique on (tenant_id, vendor_id,
 * email), not on email alone — so this returns every match, not just one.
 */
export async function findVendorLoginMatches(email: string): Promise<VendorLoginMatch[]> {
  const normalized = email.trim().toLowerCase();
  const rows = await adminDb
    .select({
      vendorUserId: vendorUsers.id,
      status: vendorUsers.status,
      vendorId: vendors.id,
      vendorName: vendors.name,
      tenantId: tenants.id,
      tenantName: tenants.name,
    })
    .from(vendorUsers)
    .innerJoin(vendors, eq(vendorUsers.vendorId, vendors.id))
    .innerJoin(tenants, eq(vendorUsers.tenantId, tenants.id))
    .where(eq(vendorUsers.email, normalized));

  return rows.filter((r) => r.status !== "disabled");
}

/**
 * First successful magic-link verification for a still-'invited' contact
 * flips them to 'active' — the same JIT-on-first-sign-in shape as
 * db/tenant.ts#linkUserOnSignIn, just for an external vendor contact
 * instead of an internal tenant user.
 */
export async function activateVendorUserIfInvited(vendorUserId: string) {
  await adminDb
    .update(vendorUsers)
    .set({ status: "active" })
    .where(and(eq(vendorUsers.id, vendorUserId), eq(vendorUsers.status, "invited")));
}

export type CurrentVendorUser = {
  vendorUserId: string;
  vendorUserEmail: string;
  vendorUserFullName: string;
  vendorId: string;
  vendorName: string;
  tenantId: string;
  tenantName: string;
};

export async function resolveVendorSession(token: string): Promise<CurrentVendorUser | null> {
  const vendorUserId = verifyVendorSessionToken(token);
  if (!vendorUserId) return null;

  const [row] = await adminDb
    .select({
      vendorUserId: vendorUsers.id,
      vendorUserEmail: vendorUsers.email,
      vendorUserFullName: vendorUsers.fullName,
      status: vendorUsers.status,
      vendorId: vendors.id,
      vendorName: vendors.name,
      tenantId: tenants.id,
      tenantName: tenants.name,
    })
    .from(vendorUsers)
    .innerJoin(vendors, eq(vendorUsers.vendorId, vendors.id))
    .innerJoin(tenants, eq(vendorUsers.tenantId, tenants.id))
    .where(eq(vendorUsers.id, vendorUserId));

  if (!row || row.status === "disabled") return null;
  return {
    vendorUserId: row.vendorUserId,
    vendorUserEmail: row.vendorUserEmail,
    vendorUserFullName: row.vendorUserFullName,
    vendorId: row.vendorId,
    vendorName: row.vendorName,
    tenantId: row.tenantId,
    tenantName: row.tenantName,
  };
}
