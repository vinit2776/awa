import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getCurrentPlatformAdmin } from "@/db/platformSession";
import { db } from "@/db/client";
import { withTenant } from "@/db/withTenant";
import { seedDefaultRoles } from "@/db/seedDefaultRoles";
import { tenants as tenantsTable } from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

async function createTenant(formData: FormData) {
  "use server";
  await getCurrentPlatformAdmin();

  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim();
  const workosOrganizationId = String(formData.get("workosOrganizationId") ?? "").trim() || null;
  if (!name || !slug) return;

  // tenants has no RLS (it's the root entity, not itself tenant-scoped
  // data) — a plain insert through app_runtime is correct here.
  const [tenant] = await db.insert(tenantsTable).values({ name, slug, workosOrganizationId }).returning();

  // Seeding roles for the tenant we just created it not a cross-tenant
  // read, so this can use withTenant like any normal tenant-scoped write.
  await withTenant(tenant.id, (tx) => seedDefaultRoles(tx, tenant.id));

  revalidatePath("/platform");
}

async function setTenantStatus(formData: FormData) {
  "use server";
  await getCurrentPlatformAdmin();
  const tenantId = String(formData.get("tenantId") ?? "");
  const status = String(formData.get("status") ?? "") as "active" | "suspended";
  if (!tenantId || !status) return;

  await db.update(tenantsTable).set({ status }).where(eq(tenantsTable.id, tenantId));
  revalidatePath("/platform");
}

async function setFeatureFlags(formData: FormData) {
  "use server";
  await getCurrentPlatformAdmin();
  const tenantId = String(formData.get("tenantId") ?? "");
  const raw = String(formData.get("featureFlags") ?? "{}");
  if (!tenantId) return;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return; // invalid JSON — silently no-op rather than crash the page; a real UI would surface this
  }

  await db.update(tenantsTable).set({ featureFlags: parsed }).where(eq(tenantsTable.id, tenantId));
  revalidatePath("/platform");
}

async function setAllowedEmailDomains(formData: FormData) {
  "use server";
  await getCurrentPlatformAdmin();
  const tenantId = String(formData.get("tenantId") ?? "");
  const raw = String(formData.get("allowedEmailDomains") ?? "");
  if (!tenantId) return;

  const domains = raw
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

  await db.update(tenantsTable).set({ allowedEmailDomains: domains }).where(eq(tenantsTable.id, tenantId));
  revalidatePath("/platform");
}

export default async function PlatformConsolePage() {
  const admin = await getCurrentPlatformAdmin();
  const tenants = await db.select().from(tenantsTable);

  return (
    <div className="flex flex-1 flex-col gap-6 p-8">
      <div>
        <h1 className="text-xl font-medium">Platform console</h1>
        <p className="text-sm text-muted-foreground">Signed in as {admin.email} ({admin.role})</p>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 font-normal">Tenant</th>
            <th className="py-2 font-normal">Slug</th>
            <th className="py-2 font-normal">Status</th>
            <th className="py-2 font-normal">WorkOS org</th>
            <th className="py-2 font-normal"></th>
          </tr>
        </thead>
        <tbody>
          {tenants.map((t) => (
            <tr key={t.id} className="border-b">
              <td className="py-2">{t.name}</td>
              <td className="py-2 font-mono text-xs text-muted-foreground">{t.slug}</td>
              <td className="py-2">{t.status}</td>
              <td className="py-2 font-mono text-xs text-muted-foreground">{t.workosOrganizationId ?? "not linked"}</td>
              <td className="py-2">
                <form action={setTenantStatus}>
                  <input type="hidden" name="tenantId" value={t.id} />
                  <input type="hidden" name="status" value={t.status === "active" ? "suspended" : "active"} />
                  <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                    {t.status === "active" ? "Suspend" : "Activate"}
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Feature flags</h2>
        {tenants.map((t) => (
          <form key={t.id} action={setFeatureFlags} className="flex items-end gap-2">
            <input type="hidden" name="tenantId" value={t.id} />
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{t.name}</label>
              <textarea
                name="featureFlags"
                defaultValue={JSON.stringify(t.featureFlags)}
                rows={1}
                className="h-8 w-96 rounded-md border px-2 py-1 font-mono text-xs"
              />
            </div>
            <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              Save
            </button>
          </form>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Domain restriction</h2>
        <p className="max-w-2xl text-xs text-muted-foreground">
          Comma-separated allowed email domains for sign-in (§09). Empty = unrestricted. Enforced at JIT
          sign-in linking, on top of — not instead of — needing a pre-provisioned users row.
        </p>
        {tenants.map((t) => (
          <form key={t.id} action={setAllowedEmailDomains} className="flex items-end gap-2">
            <input type="hidden" name="tenantId" value={t.id} />
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{t.name}</label>
              <input
                name="allowedEmailDomains"
                defaultValue={t.allowedEmailDomains.join(", ")}
                placeholder="e.g. acme.com, acme.co.in"
                className="h-8 w-96 rounded-md border px-2 text-sm"
              />
            </div>
            <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              Save
            </button>
          </form>
        ))}
      </div>

      <form action={createTenant} className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="name" className="text-xs text-muted-foreground">Name</label>
          <input id="name" name="name" required className="h-8 rounded-md border px-2 text-sm" placeholder="Oil Extraction Co Ltd" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="slug" className="text-xs text-muted-foreground">Slug</label>
          <input id="slug" name="slug" required className="h-8 rounded-md border px-2 text-sm" placeholder="oil-extraction-co" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="workosOrganizationId" className="text-xs text-muted-foreground">WorkOS org ID (optional)</label>
          <input id="workosOrganizationId" name="workosOrganizationId" className="h-8 rounded-md border px-2 text-sm" placeholder="org_..." />
        </div>
        <button type="submit" className={cn(buttonVariants())}>Create tenant</button>
      </form>
    </div>
  );
}
