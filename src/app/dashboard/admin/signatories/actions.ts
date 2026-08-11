"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { logAction } from "@/db/audit";
import { signatories } from "@/db/schema";

export async function createSignatory(formData: FormData) {
  const { user, tenant } = await getCurrentUserAndTenant();
  const userId = String(formData.get("userId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const maxAuthorizedValue = String(formData.get("maxAuthorizedValue") ?? "").trim() || null;
  if (!userId || !title) return;

  await withTenant(tenant.id, async (tx) => {
    const [created] = await tx.insert(signatories).values({ tenantId: tenant.id, userId, title, maxAuthorizedValue }).returning();
    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "signatory.created",
      entityType: "signatory",
      entityId: created.id,
      metadata: { userId, title },
    });
  });

  revalidatePath("/dashboard/admin/signatories");
}

export async function toggleSignatoryActive(formData: FormData) {
  const { user, tenant } = await getCurrentUserAndTenant();
  const signatoryId = String(formData.get("signatoryId") ?? "");
  const active = formData.get("active") === "true";
  if (!signatoryId) return;

  await withTenant(tenant.id, async (tx) => {
    await tx.update(signatories).set({ active }).where(eq(signatories.id, signatoryId));
    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: active ? "signatory.activated" : "signatory.deactivated",
      entityType: "signatory",
      entityId: signatoryId,
      metadata: {},
    });
  });

  revalidatePath("/dashboard/admin/signatories");
}
