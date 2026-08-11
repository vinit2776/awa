"use server";

import { redirect } from "next/navigation";
import { activateVendorUserIfInvited, findVendorLoginMatches, verifyMagicLinkToken } from "@/db/vendorAuth";
import { setVendorSessionCookie } from "@/db/vendorSession";

export async function chooseVendorAccount(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const vendorUserId = String(formData.get("vendorUserId") ?? "");

  const email = verifyMagicLinkToken(token);
  if (!email) redirect("/vendor-portal/login?error=expired");

  // Re-derive the match set from the token's email rather than trusting
  // vendorUserId alone — otherwise a tampered form field could log the
  // browser into any vendor_users row, not just one tied to the email
  // that was actually verified.
  const matches = await findVendorLoginMatches(email);
  const match = matches.find((m) => m.vendorUserId === vendorUserId);
  if (!match) redirect("/vendor-portal/login?error=expired");

  await activateVendorUserIfInvited(match.vendorUserId);
  await setVendorSessionCookie(match.vendorUserId);
  redirect("/vendor-portal");
}
