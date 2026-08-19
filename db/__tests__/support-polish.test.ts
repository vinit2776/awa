import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "../adminClient";
import { db } from "../client";
import { withTenant } from "../withTenant";
import { parseConsoleErrors, resolveSlaTargets } from "../supportRouting";
import { failureFrom } from "./dbFailure";
import {
  supportSavedReplies,
  supportSlaOverrides,
  supportTickets,
  tenants,
  users,
} from "../schema";

/**
 * Phase D. Two behaviours here have real failure modes worth pinning:
 *
 *  1. An override must actually win. Because support_sla_overrides is
 *     tenant-scoped and behind RLS, a lookup made without a tenant scope sees
 *     nothing and silently falls back to the global policy — quietly ignoring a
 *     customer's negotiated SLA rather than failing. That's the bug this file
 *     exists to catch.
 *  2. CSAT must be answerable: a rating without a timestamp would make "did
 *     they respond?" unanswerable, which is the only question the data exists
 *     to answer.
 */

let tenantA: typeof tenants.$inferSelect;
let tenantB: typeof tenants.$inferSelect;
let userA: typeof users.$inferSelect;

const T0 = new Date("2026-01-01T00:00:00Z");
const minutesBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 60_000);

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  [tenantA] = await adminDb
    .insert(tenants)
    .values({ name: "Polish A", slug: `polish-a-${suffix}` })
    .returning();
  [tenantB] = await adminDb
    .insert(tenants)
    .values({ name: "Polish B", slug: `polish-b-${suffix}` })
    .returning();

  [userA] = await withTenant(tenantA.id, (tx) =>
    tx
      .insert(users)
      .values({ tenantId: tenantA.id, email: `polish-${suffix}@example.com`, fullName: "Reporter", status: "active" })
      .returning(),
  );
});

afterAll(async () => {
  for (const t of [tenantA, tenantB]) {
    await adminDb.delete(supportSlaOverrides).where(eq(supportSlaOverrides.tenantId, t.id));
    await adminDb.delete(supportTickets).where(eq(supportTickets.tenantId, t.id));
    await adminDb.delete(users).where(eq(users.tenantId, t.id));
    await adminDb.delete(tenants).where(eq(tenants.id, t.id));
  }
});

describe("per-tenant SLA overrides", () => {
  it("falls back to the standard policy when a tenant has no override", async () => {
    const targets = await withTenant(tenantA.id, (tx) => resolveSlaTargets("bug", "urgent", T0, tx));
    // Standard bug/urgent: 60 / 480.
    expect(minutesBetween(T0, targets.firstResponseDueAt!)).toBe(60);
    expect(minutesBetween(T0, targets.resolutionDueAt!)).toBe(480);
  });

  it("an override beats the standard policy for that tenant only", async () => {
    await withTenant(tenantA.id, (tx) =>
      tx.insert(supportSlaOverrides).values({
        tenantId: tenantA.id,
        ticketType: "bug",
        priority: "urgent",
        firstResponseMinutes: 15,
        resolutionMinutes: 120,
      }),
    );

    const a = await withTenant(tenantA.id, (tx) => resolveSlaTargets("bug", "urgent", T0, tx));
    expect(minutesBetween(T0, a.firstResponseDueAt!)).toBe(15);
    expect(minutesBetween(T0, a.resolutionDueAt!)).toBe(120);

    // The neighbouring tenant is untouched — this is the isolation that makes
    // a negotiated SLA safe to grant to one customer.
    const b = await withTenant(tenantB.id, (tx) => resolveSlaTargets("bug", "urgent", T0, tx));
    expect(minutesBetween(T0, b.firstResponseDueAt!)).toBe(60);
  });

  it("an override can REMOVE a resolution target the standard policy sets", async () => {
    await withTenant(tenantA.id, (tx) =>
      tx.insert(supportSlaOverrides).values({
        tenantId: tenantA.id,
        ticketType: "question",
        priority: "normal",
        firstResponseMinutes: 60,
        resolutionMinutes: null,
      }),
    );

    const targets = await withTenant(tenantA.id, (tx) => resolveSlaTargets("question", "normal", T0, tx));
    expect(targets.firstResponseDueAt).not.toBeNull();
    // null is meaningful, not missing data.
    expect(targets.resolutionDueAt).toBeNull();
  });

  it("without a tenant scope the override is invisible — which is why the lookup takes a tx", async () => {
    // Called with no transaction, exactly as a caller outside withTenant would.
    // It silently returns the standard policy rather than erroring, so nothing
    // but this test would reveal the customer's negotiated SLA being ignored.
    const unscoped = await resolveSlaTargets("bug", "urgent", T0);
    expect(minutesBetween(T0, unscoped.firstResponseDueAt!)).toBe(60);

    // And confirm RLS is what's hiding it, not an empty table.
    const viaOwner = await adminDb
      .select()
      .from(supportSlaOverrides)
      .where(eq(supportSlaOverrides.tenantId, tenantA.id));
    expect(viaOwner.length).toBeGreaterThan(0);

    const viaAppRuntime = await db
      .select()
      .from(supportSlaOverrides)
      .where(eq(supportSlaOverrides.tenantId, tenantA.id));
    expect(viaAppRuntime).toHaveLength(0);
  });
});

describe("CSAT", () => {
  it("rejects a rating with no timestamp", async () => {
    const [ticket] = await withTenant(tenantA.id, (tx) =>
      tx
        .insert(supportTickets)
        .values({
          tenantId: tenantA.id,
          type: "bug",
          subject: "Rate me",
          description: "…",
          reportedByUserId: userA.id,
          status: "resolved",
          resolvedAt: new Date(),
          resolutionOutcome: "fixed",
          resolutionSummary: "done",
        })
        .returning(),
    );

    const failure = await failureFrom(() =>
      withTenant(tenantA.id, (tx) =>
        tx.update(supportTickets).set({ csatRating: "positive" }).where(eq(supportTickets.id, ticket.id)),
      ),
    );
    expect(failure.constraint).toBe("support_csat_complete");
  });

  it("accepts a rating that carries its timestamp", async () => {
    const [ticket] = await withTenant(tenantA.id, (tx) =>
      tx
        .insert(supportTickets)
        .values({
          tenantId: tenantA.id,
          type: "bug",
          subject: "Rate me too",
          description: "…",
          reportedByUserId: userA.id,
          status: "resolved",
          resolvedAt: new Date(),
          resolutionOutcome: "fixed",
          resolutionSummary: "done",
        })
        .returning(),
    );

    await withTenant(tenantA.id, (tx) =>
      tx
        .update(supportTickets)
        .set({ csatRating: "negative", csatComment: "Took too long", csatAt: new Date() })
        .where(eq(supportTickets.id, ticket.id)),
    );

    const [after] = await withTenant(tenantA.id, (tx) =>
      tx.select().from(supportTickets).where(eq(supportTickets.id, ticket.id)),
    );
    expect(after.csatRating).toBe("negative");
    expect(after.csatComment).toBe("Took too long");
  });
});

describe("console error capture", () => {
  it("round-trips the captured entries as structured data", async () => {
    const entries = [
      { message: "TypeError: x is not a function", source: "page.js", line: 42, at: T0.toISOString() },
      { message: "Unhandled rejection: 500", at: T0.toISOString() },
    ];

    const [ticket] = await withTenant(tenantA.id, (tx) =>
      tx
        .insert(supportTickets)
        .values({
          tenantId: tenantA.id,
          type: "bug",
          subject: "With errors",
          description: "…",
          reportedByUserId: userA.id,
          consoleErrors: entries,
        })
        .returning(),
    );

    const [after] = await withTenant(tenantA.id, (tx) =>
      tx.select().from(supportTickets).where(eq(supportTickets.id, ticket.id)),
    );
    expect(after.consoleErrors).toHaveLength(2);
    expect(after.consoleErrors?.[0].message).toContain("not a function");
    expect(after.consoleErrors?.[0].line).toBe(42);
  });
});

describe("saved replies", () => {
  it("seeds replies scoped to a type, plus the wildcard convention", async () => {
    const rows = await db.select().from(supportSavedReplies);
    expect(rows.length).toBeGreaterThanOrEqual(4);

    const bugReplies = rows.filter((r) => r.appliesTo.length === 0 || r.appliesTo.includes("bug"));
    expect(bugReplies.length).toBeGreaterThan(0);
    // A feature-request macro must not surface on a bug.
    const featureOnly = rows.find((r) => r.appliesTo.length === 1 && r.appliesTo[0] === "feature_request");
    expect(featureOnly).toBeDefined();
    expect(bugReplies).not.toContainEqual(featureOnly);
  });
});

describe("console errors — the client is not trusted", () => {
  // This payload arrives as a JSON string from a browser the server does not
  // control. Every case below is something a hostile or broken client could
  // send; none of them may throw, because a malformed diagnostic must never
  // cost the user their bug report.
  it("returns null for anything that isn't a JSON array", () => {
    expect(parseConsoleErrors(null)).toBeNull();
    expect(parseConsoleErrors("")).toBeNull();
    expect(parseConsoleErrors("not json at all")).toBeNull();
    expect(parseConsoleErrors('{"not":"an array"}')).toBeNull();
    expect(parseConsoleErrors("[]")).toBeNull();
  });

  it("truncates a long message rather than storing it whole", () => {
    // The tail of a message is where interpolated application data lives, and
    // this app holds bank details and vendor pricing.
    const parsed = parseConsoleErrors(JSON.stringify([{ message: "x".repeat(5000), at: "2026-01-01T00:00:00Z" }]));
    expect(parsed).toHaveLength(1);
    expect(parsed![0].message).toHaveLength(300);
  });

  it("caps the number of entries no matter how many are sent", () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ message: `err ${i}`, at: "2026-01-01T00:00:00Z" }));
    const parsed = parseConsoleErrors(JSON.stringify(many));
    expect(parsed).toHaveLength(20);
    // Keeps the most recent — those describe the state being reported from.
    expect(parsed![19].message).toBe("err 499");
  });

  it("drops junk entries and coerces wrong-typed fields instead of trusting them", () => {
    const parsed = parseConsoleErrors(
      JSON.stringify([
        "a bare string",
        null,
        { message: "" },
        { message: "real", line: "not a number", source: 42, at: 12345 },
      ]),
    );
    expect(parsed).toHaveLength(1);
    expect(parsed![0].message).toBe("real");
    expect(parsed![0].line).toBeUndefined();
    // A non-string timestamp is replaced, not stored — the field must stay
    // parseable for anything reading the timeline later.
    expect(() => new Date(parsed![0].at).toISOString()).not.toThrow();
  });
});
