"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAdmin } from "@/db/permissions";
import { withTenant } from "@/db/withTenant";
import { addBankAccount, verifyBankAccountByCallback } from "@/db/bankAccounts";

export async function submitBankAccount(formData: FormData) {
  const vendorId = String(formData.get("vendorId") ?? "");
  const accountHolderName = String(formData.get("accountHolderName") ?? "").trim();
  const accountNumber = String(formData.get("accountNumber") ?? "").trim();
  const bankName = String(formData.get("bankName") ?? "").trim();
  const ifscOrSwift = String(formData.get("ifscOrSwift") ?? "").trim();
  if (!vendorId || !accountHolderName || !accountNumber || !bankName || !ifscOrSwift) return;

  const { user, tenant } = await requireTenantAdmin();
  await withTenant(tenant.id, (tx) => addBankAccount(tx, tenant.id, user.id, vendorId, { accountHolderName, accountNumber, bankName, ifscOrSwift }));

  revalidatePath(`/dashboard/admin/vendors/${vendorId}`);
}

export async function verifyBankAccount(formData: FormData) {
  const vendorId = String(formData.get("vendorId") ?? "");
  const bankAccountId = String(formData.get("bankAccountId") ?? "");
  const confirmedCallback = formData.get("confirmedCallback") === "on";
  if (!vendorId || !bankAccountId || !confirmedCallback) return;

  const { user, tenant } = await requireTenantAdmin();
  await withTenant(tenant.id, (tx) => verifyBankAccountByCallback(tx, tenant.id, user.id, bankAccountId));

  revalidatePath(`/dashboard/admin/vendors/${vendorId}`);
}
