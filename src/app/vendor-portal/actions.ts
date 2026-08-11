"use server";

import { redirect } from "next/navigation";
import { clearVendorSessionCookie } from "@/db/vendorSession";

export async function vendorLogout() {
  await clearVendorSessionCookie();
  redirect("/vendor-portal/login");
}
