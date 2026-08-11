import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "../adminClient";
import { isPlatformAdminEmail } from "../platformAdmins";
import { platformAdmins } from "../schema";

let admin: typeof platformAdmins.$inferSelect;

beforeAll(async () => {
  [admin] = await adminDb
    .insert(platformAdmins)
    .values({ email: "pa-test@example.com", fullName: "Pat Admin", role: "support" })
    .returning();
});

afterAll(async () => {
  await adminDb.delete(platformAdmins).where(eq(platformAdmins.id, admin.id));
});

describe("isPlatformAdminEmail", () => {
  it("matches a platform admin's email", async () => {
    expect(await isPlatformAdminEmail("pa-test@example.com")).toBe(true);
  });

  it("does not match a tenant user's email", async () => {
    expect(await isPlatformAdminEmail("definitely-not-an-admin@example.com")).toBe(false);
  });

  // The callback route (src/app/callback/route.ts) checks this before
  // calling linkUserOnSignIn — a platform admin has no tenant/users row
  // to link, so that call would always throw a TenantLinkError for them
  // without this check. Not exercised end to end here (no way to
  // automate a real WorkOS session, same constraint golden-path.test.ts
  // documents), but this is the exact predicate that decision is made on.
});
