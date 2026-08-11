import { describe, expect, it } from "vitest";
import { encryptBankAccountNumber, decryptBankAccountNumber, last4 } from "../crypto";

describe("bank account number encryption", () => {
  it("round-trips a plaintext account number", () => {
    const plaintext = "1234567890123456";
    const encrypted = encryptBankAccountNumber(plaintext);
    expect(encrypted).not.toContain(plaintext);
    expect(decryptBankAccountNumber(encrypted)).toBe(plaintext);
  });

  it("produces a different ciphertext each time (random IV) for the same input", () => {
    const plaintext = "1234567890123456";
    const a = encryptBankAccountNumber(plaintext);
    const b = encryptBankAccountNumber(plaintext);
    expect(a).not.toBe(b);
    expect(decryptBankAccountNumber(a)).toBe(plaintext);
    expect(decryptBankAccountNumber(b)).toBe(plaintext);
  });

  it("fails to decrypt if the ciphertext has been tampered with", () => {
    const encrypted = encryptBankAccountNumber("1234567890123456");
    const [iv, tag, ciphertext] = encrypted.split(":");
    const tampered = `${iv}:${tag}:${ciphertext.slice(0, -4)}AAAA`;
    expect(() => decryptBankAccountNumber(tampered)).toThrow();
  });

  it("masks to the last 4 digits", () => {
    expect(last4("1234567890123456")).toBe("3456");
    expect(last4("12")).toBe("••12");
  });
});
