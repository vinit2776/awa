import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "../adminClient";
import { withTenant } from "../withTenant";
import { pickAssignee, resolveSlaTargets, slaState } from "../supportRouting";
import {
  platformAdmins,
  supportAgents,
  supportSlaPolicies,
  supportTickets,
  tenants,
  users,
} from "../schema";

/**
 * Phase B: routing and the TAT clock.
 *
 * The routing test that matters most is the cross-tenant one. An agent's load
 * spans every customer, so a count taken inside withTenant would see only the
 * current tenant and hand every new ticket to whoever happens to be quiet
 * there. That bug would be invisible with a single tenant, so these fixtures
 * deliberately use two.
 */

let tenantA: typeof tenants.$inferSelect;
let tenantB: typeof tenants.$inferSelect;
let userA: typeof users.$inferSelect;
let userB: typeof users.$inferSelect;
let quiet: typeof platformAdmins.$inferSelect;   // idle in tenant A, buried in tenant B
let busy: typeof platformAdmins.$inferSelect;    // the reverse
let owner: typeof platformAdmins.$inferSelect;   // named account owner for tenant A
const adminIds: string[] = [];

async function makeTenant(label: string, suffix: string) {
  const [tenant] = await adminDb
    .insert(tenants)
    .values({ name: `Routing ${label}`, slug: `routing-${label}-${suffix}` })
    .returning();
  const [user] = await withTenant(tenant.id, (tx) =>
    tx
      .insert(users)
      .values({ tenantId: tenant.id, email: `${label}-${suffix}@example.com`, fullName: `User ${label}`, status: "active" })
      .returning(),
  );
  return { tenant, user };
}

async function makeAdmin(label: string, suffix: string) {
  const [admin] = await adminDb
    .insert(platformAdmins)
    .values({ email: `${label}-${suffix}@awa.test`, fullName: `Agent ${label}`, role: "support" })
    .returning();
  adminIds.push(admin.id);
  return admin;
}

/** Open tickets pin an agent's load; assignedAt drives the tie-break. */
async function seedTickets(
  tenant: typeof tenants.$inferSelect,
  user: typeof users.$inferSelect,
  adminId: string,
  count: number,
) {
  for (let i = 0; i < count; i++) {
    await withTenant(tenant.id, (tx) =>
      tx.insert(supportTickets).values({
        tenantId: tenant.id,
        type: "bug",
        subject: `load ${i}`,
        description: "…",
        reportedByUserId: user.id,
        assignedToAdminId: adminId,
        assignedAt: new Date(),
        status: "in_progress",
      }),
    );
  }
}

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  ({ tenant: tenantA, user: userA } = await makeTenant("a", suffix));
  ({ tenant: tenantB, user: userB } = await makeTenant("b", suffix));

  quiet = await makeAdmin("quiet", suffix);
  busy = await makeAdmin("busy", suffix);
  owner = await makeAdmin("owner", suffix);

  // Deactivate every pre-existing agent so the roster under test is only ours;
  // the migration seeds one per platform_admin.
  await adminDb.update(supportAgents).set({ active: false });
  await adminDb.insert(supportAgents).values([
    { platformAdminId: quiet.id },
    { platformAdminId: busy.id },
  ]);

  // `quiet` looks idle in tenant A but is the busiest overall; `busy` is the
  // reverse. Anything counting load per-tenant picks the wrong one.
  await seedTickets(tenantB, userB, quiet.id, 3);
  await seedTickets(tenantA, userA, busy.id, 1);
});

afterAll(async () => {
  for (const t of [tenantA, tenantB]) {
    await adminDb.delete(supportTickets).where(eq(supportTickets.tenantId, t.id));
    await adminDb.delete(users).where(eq(users.tenantId, t.id));
  }
  await adminDb.delete(supportAgents).where(inArray(supportAgents.platformAdminId, adminIds));
  await adminDb.delete(platformAdmins).where(inArray(platformAdmins.id, adminIds));
  await adminDb.delete(tenants).where(inArray(tenants.id, [tenantA.id, tenantB.id]));
  // Restore the agents the migration seeded.
  await adminDb.update(supportAgents).set({ active: true });
});

describe("SLA targets", () => {
  const t0 = new Date("2026-01-01T00:00:00Z");

  it("gives an urgent bug an hour to first response and eight to resolution", async () => {
    const targets = await resolveSlaTargets("bug", "urgent", t0);
    expect(targets.firstResponseDueAt?.toISOString()).toBe("2026-01-01T01:00:00.000Z");
    expect(targets.resolutionDueAt?.toISOString()).toBe("2026-01-01T08:00:00.000Z");
  });

  it("scales the resolution target down with priority", async () => {
    const urgent = await resolveSlaTargets("bug", "urgent", t0);
    const low = await resolveSlaTargets("bug", "low", t0);
    expect(low.resolutionDueAt!.getTime()).toBeGreaterThan(urgent.resolutionDueAt!.getTime());
  });

  it("gives a feature request a response target but NO resolution target", async () => {
    // The one that would otherwise make every backlog item a permanent breach.
    const targets = await resolveSlaTargets("feature_request", "normal", t0);
    expect(targets.firstResponseDueAt).not.toBeNull();
    expect(targets.resolutionDueAt).toBeNull();
  });

  it("covers every type and priority pair, so a lookup can't silently miss", async () => {
    const rows = await adminDb.select().from(supportSlaPolicies);
    expect(rows).toHaveLength(16);
  });
});

describe("auto-assignment", () => {
  it("counts load across ALL tenants, not just the ticket's own", async () => {
    // `busy` has 1 open ticket overall; `quiet` has 3, all in tenant B. Scoped
    // to tenant A alone, `quiet` looks like the idle one — this asserts the
    // opposite, which is only true if the count is genuinely cross-tenant.
    const chosen = await pickAssignee(tenantA.id, "bug");
    expect(chosen).toBe(busy.id);
  });

  it("gives a named account owner the ticket regardless of load", async () => {
    await adminDb
      .insert(supportAgents)
      .values({ platformAdminId: owner.id, coversTenantIds: [tenantA.id] });
    // Make the owner the most loaded agent there is.
    await seedTickets(tenantB, userB, owner.id, 5);

    expect(await pickAssignee(tenantA.id, "bug")).toBe(owner.id);
    // …and only for the tenant they actually cover.
    expect(await pickAssignee(tenantB.id, "bug")).toBe(busy.id);

    await adminDb.delete(supportTickets).where(eq(supportTickets.assignedToAdminId, owner.id));
    await adminDb.delete(supportAgents).where(eq(supportAgents.platformAdminId, owner.id));
  });

  it("skips agents who don't handle the type", async () => {
    await adminDb.update(supportAgents).set({ handlesTypes: ["feedback"] }).where(eq(supportAgents.platformAdminId, busy.id));
    // busy handles only feedback now, so a bug must go to quiet despite the load.
    expect(await pickAssignee(tenantA.id, "bug")).toBe(quiet.id);
    expect(await pickAssignee(tenantA.id, "feedback")).toBe(busy.id);
    await adminDb.update(supportAgents).set({ handlesTypes: [] }).where(eq(supportAgents.platformAdminId, busy.id));
  });

  it("leaves a ticket unassigned rather than pushing past max_open", async () => {
    await adminDb.update(supportAgents).set({ maxOpen: 1 }).where(eq(supportAgents.platformAdminId, busy.id));
    await adminDb.update(supportAgents).set({ maxOpen: 1 }).where(eq(supportAgents.platformAdminId, quiet.id));

    // busy is at 1/1 and quiet at 3/1 — both full.
    expect(await pickAssignee(tenantA.id, "bug")).toBeNull();

    await adminDb.update(supportAgents).set({ maxOpen: null }).where(inArray(supportAgents.platformAdminId, [busy.id, quiet.id]));
  });

  it("returns null when the roster is empty, so the ticket is still created", async () => {
    await adminDb.update(supportAgents).set({ active: false }).where(inArray(supportAgents.platformAdminId, adminIds));
    expect(await pickAssignee(tenantA.id, "bug")).toBeNull();
    await adminDb.update(supportAgents).set({ active: true }).where(inArray(supportAgents.platformAdminId, [busy.id, quiet.id]));
  });
});

describe("SLA state is derived, never stored", () => {
  const base = {
    status: "in_progress",
    firstRespondedAt: null,
    firstResponseDueAt: new Date(Date.now() - 60_000),
    resolvedAt: null,
    resolutionDueAt: new Date(Date.now() - 60_000),
    awaitingCustomerSince: null,
  };

  it("reports a breach once the due date has passed with no response", () => {
    const state = slaState(base);
    expect(state.firstResponseBreached).toBe(true);
    expect(state.resolutionBreached).toBe(true);
  });

  it("a paused ticket cannot breach its resolution clock", () => {
    // The entire point of pausing: time on the customer's side must not count
    // against support, or every slow reply reads as a support failure.
    const state = slaState({ ...base, status: "awaiting_customer", awaitingCustomerSince: new Date() });
    expect(state.resolutionBreached).toBe(false);
    expect(state.paused).toBe(true);
    expect(state.minutesToResolution).toBeNull();
  });

  it("a resolved ticket stops breaching", () => {
    const state = slaState({ ...base, status: "resolved", resolvedAt: new Date() });
    expect(state.resolutionBreached).toBe(false);
  });

  it("a first response already given can't breach, even overdue", () => {
    const state = slaState({ ...base, firstRespondedAt: new Date() });
    expect(state.firstResponseBreached).toBe(false);
  });

  it("no resolution target means no resolution breach, ever", () => {
    const state = slaState({ ...base, resolutionDueAt: null });
    expect(state.resolutionBreached).toBe(false);
    expect(state.minutesToResolution).toBeNull();
  });
});
