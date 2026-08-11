import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for vendor_bank_accounts.account_number_enc — the column
 * was already named for encryption (the "_enc" suffix), nothing in the
 * codebase actually did it until now. Key comes from
 * BANK_ACCOUNT_ENCRYPTION_KEY, a base64-encoded 32-byte key generated
 * with `openssl rand -base64 32` — same discipline as every other
 * secret in this project (generated locally, never typed/known by an
 * agent, set via `vercel env add`, documented in .env.example without
 * a value). Format: "<iv_b64>:<authTag_b64>:<ciphertext_b64>",
 * self-contained so nothing else needs to track IVs separately.
 */
function getKey(): Buffer {
  const raw = process.env.BANK_ACCOUNT_ENCRYPTION_KEY;
  if (!raw) throw new Error("BANK_ACCOUNT_ENCRYPTION_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("BANK_ACCOUNT_ENCRYPTION_KEY must decode to exactly 32 bytes");
  return key;
}

export function encryptBankAccountNumber(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptBankAccountNumber(encoded: string): string {
  const [ivB64, authTagB64, ciphertextB64] = encoded.split(":");
  if (!ivB64 || !authTagB64 || !ciphertextB64) throw new Error("Malformed encrypted bank account number");
  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextB64, "base64")), decipher.final()]).toString("utf8");
}

export function last4(accountNumber: string): string {
  return accountNumber.slice(-4).padStart(4, "•");
}
