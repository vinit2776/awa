/**
 * Shared between JIT sign-in linking (db/tenant.ts) and the user-invite
 * form (S15) — both need the exact same answer to "is this email allowed
 * for this tenant," and defining it twice risks the invite form
 * accepting an email that sign-in would later reject (or vice versa).
 * Empty allowedEmailDomains means unrestricted.
 */
export function isEmailAllowedForTenant(allowedEmailDomains: string[], email: string): boolean {
  if (allowedEmailDomains.length === 0) return true;
  const domain = email.split("@")[1]?.toLowerCase();
  return !!domain && allowedEmailDomains.includes(domain);
}
