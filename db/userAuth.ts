import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { adminDb } from "./adminClient";
import { db } from "./client";
import { platformAdmins, tenants, users } from "./schema";

const scryptAsync = promisify(scrypt);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [saltHex, keyHex] = hash.split(":");
  if (!saltHex || !keyHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const storedKey = Buffer.from(keyHex, "hex");
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return storedKey.length === derivedKey.length && timingSafeEqual(storedKey, derivedKey);
}

// Same self-verifying signed-token shape as db/vendorAuth.ts (HMAC over a
// payload + expiry, no server-side token table) — kept as a separate,
// parallel implementation rather than a shared import because vendor auth
// is untouched by this swap and shouldn't pick up a dependency on it.
const SET_PASSWORD_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

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

// "kind:id" payload prefix so a user token and a platform-admin token can
// never be confused for one another even if both landed in the same place.
export function makeUserSetPasswordToken(userId: string): string {
  return makeToken(`user:${userId}`, SET_PASSWORD_TTL_MS);
}
export function verifyUserSetPasswordToken(token: string): string | null {
  const payload = verifyToken(token);
  return payload?.startsWith("user:") ? payload.slice(5) : null;
}
export function makeUserSessionToken(userId: string): string {
  return makeToken(`user:${userId}`, SESSION_TTL_MS);
}
export function verifyUserSessionToken(token: string): string | null {
  const payload = verifyToken(token);
  return payload?.startsWith("user:") ? payload.slice(5) : null;
}

export function makePlatformAdminSetPasswordToken(adminId: string): string {
  return makeToken(`admin:${adminId}`, SET_PASSWORD_TTL_MS);
}
export function verifyPlatformAdminSetPasswordToken(token: string): string | null {
  const payload = verifyToken(token);
  return payload?.startsWith("admin:") ? payload.slice(6) : null;
}
export function makePlatformAdminSessionToken(adminId: string): string {
  return makeToken(`admin:${adminId}`, SESSION_TTL_MS);
}
export function verifyPlatformAdminSessionToken(token: string): string | null {
  const payload = verifyToken(token);
  return payload?.startsWith("admin:") ? payload.slice(6) : null;
}

// Encodes an already-password-verified set of candidate userIds, not the
// password itself — the password must never end up in a URL (query
// strings land in server/browser logs and history). Short TTL: this only
// needs to survive one redirect hop for the rare same-email-same-password
// multi-tenant case.
const TENANT_CHOICE_TTL_MS = 5 * 60 * 1000;

export function makeTenantChoiceToken(userIds: string[]): string {
  return makeToken(`choice:${userIds.join(",")}`, TENANT_CHOICE_TTL_MS);
}
export function verifyTenantChoiceToken(token: string): string[] | null {
  const payload = verifyToken(token);
  if (!payload?.startsWith("choice:")) return null;
  return payload.slice(7).split(",").filter(Boolean);
}

export type AuthenticatedUserMatch = { userId: string; tenantId: string; tenantName: string };

/**
 * Password is checked per-row, not once against "the" account for this
 * email — users is unique on (tenant_id, email), not email alone, so the
 * same person can legitimately hold an independent row (and password) in
 * more than one tenant, same shape as vendor_users (db/vendorAuth.ts).
 * Returns every row whose own password_hash matches, not just the first.
 */
export async function authenticateUser(email: string, password: string): Promise<AuthenticatedUserMatch[]> {
  const normalized = email.trim().toLowerCase();
  const rows = await adminDb
    .select({ userId: users.id, tenantId: tenants.id, tenantName: tenants.name, passwordHash: users.passwordHash, status: users.status })
    .from(users)
    .innerJoin(tenants, eq(users.tenantId, tenants.id))
    .where(eq(users.email, normalized));

  const matches: AuthenticatedUserMatch[] = [];
  for (const row of rows) {
    if (row.status === "disabled" || !row.passwordHash) continue;
    if (await verifyPassword(password, row.passwordHash)) {
      matches.push({ userId: row.userId, tenantId: row.tenantId, tenantName: row.tenantName });
    }
  }
  return matches;
}

export async function authenticatePlatformAdmin(email: string, password: string): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  const [admin] = await db
    .select({ id: platformAdmins.id, passwordHash: platformAdmins.passwordHash })
    .from(platformAdmins)
    .where(eq(platformAdmins.email, normalized))
    .limit(1);

  if (!admin || !admin.passwordHash) return null;
  return (await verifyPassword(password, admin.passwordHash)) ? admin.id : null;
}
