"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { sendVendorMagicLink } from "@/db/vendorAuth";

export async function requestVendorMagicLink(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return;

  const hdrs = await headers();
  const proto = hdrs.get("x-forwarded-proto") ?? "http";
  const host = hdrs.get("host");
  await sendVendorMagicLink(email, `${proto}://${host}`);

  redirect("/vendor-portal/login?sent=1");
}
