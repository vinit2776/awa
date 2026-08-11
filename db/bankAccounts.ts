import { and, eq } from "drizzle-orm";
import type { db } from "./client";
import { logAction } from "./audit";
import { encryptBankAccountNumber, last4 } from "./crypto";
import { vendorBankAccounts } from "./schema";

/**
 * "Bank-detail changes are locked after onboarding and can only change
 * through an out-of-band callback to the vendor's originally
 * registered number" (§05). The lock isn't a permission check on this
 * insert — a new bank account can always be added — the lock is that
 * it lands as pending_verification and simply isn't usable (nothing
 * queries for it; only the 'active' row is ever meant to be paid to)
 * until verifyBankAccountByCallback promotes it. The previous active
 * row, if any, keeps working right up until the new one clears
 * verification — never a window with zero valid bank details, and
 * never a window where an unverified one is live.
 */
export async function addBankAccount(
  tx: typeof db,
  tenantId: string,
  actorUserId: string,
  vendorId: string,
  params: { accountHolderName: string; accountNumber: string; bankName: string; ifscOrSwift: string },
) {
  const [created] = await tx
    .insert(vendorBankAccounts)
    .values({
      tenantId,
      vendorId,
      accountHolderName: params.accountHolderName,
      accountNumberEnc: encryptBankAccountNumber(params.accountNumber),
      accountNumberLast4: last4(params.accountNumber),
      bankName: params.bankName,
      ifscOrSwift: params.ifscOrSwift,
      status: "pending_verification",
    })
    .returning();

  await logAction(tx, {
    tenantId,
    actorUserId,
    action: "vendor_bank_account.added",
    entityType: "vendor_bank_account",
    entityId: created.id,
    metadata: { vendorId, last4: created.accountNumberLast4 },
  });

  return created;
}

/**
 * The out-of-band verification step itself: someone actually called the
 * vendor at their registered_phone and confirmed the details verbally.
 * This function trusts that already happened — it's not a phone-call
 * integration, it's the system-of-record entry for one. Promotes this
 * row to active and, in the same transaction, supersedes whichever row
 * was previously active for this vendor (there is at most one active
 * row per vendor at a time — that's the rotation, not a DB constraint,
 * since going through this single code path is what enforces it).
 */
export async function verifyBankAccountByCallback(
  tx: typeof db,
  tenantId: string,
  actorUserId: string,
  bankAccountId: string,
): Promise<{ error?: string }> {
  const [account] = await tx
    .select()
    .from(vendorBankAccounts)
    .where(and(eq(vendorBankAccounts.id, bankAccountId), eq(vendorBankAccounts.status, "pending_verification")));
  if (!account) return { error: "Not found, or already verified." };

  await tx
    .update(vendorBankAccounts)
    .set({ status: "superseded" })
    .where(and(eq(vendorBankAccounts.vendorId, account.vendorId), eq(vendorBankAccounts.status, "active")));

  await tx
    .update(vendorBankAccounts)
    .set({ status: "active", verifiedBy: actorUserId, verifiedAt: new Date() })
    .where(eq(vendorBankAccounts.id, bankAccountId));

  await logAction(tx, {
    tenantId,
    actorUserId,
    action: "vendor_bank_account.verified",
    entityType: "vendor_bank_account",
    entityId: bankAccountId,
    metadata: { vendorId: account.vendorId },
  });

  return {};
}
