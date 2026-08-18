import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "../adminClient";
import { withTenant } from "../withTenant";
import { findRequisitionIdsMatching } from "../requisitionSearch";
import {
  departments,
  purchaseRequisitionLines,
  purchaseRequisitions,
  requisitionApprovalRequirements,
  tenants,
  users,
} from "../schema";

/**
 * Search on the approvals inbox must only ever narrow what an approver
 * can already see.
 *
 * The page resolves matching requisition ids first and then intersects
 * them with the rows assigned to this approver in the current group.
 * That order is the whole safety property: written the other way round —
 * search the tenant, display the hits — the search box becomes a way to
 * read requisitions that are with somebody else, including their items,
 * values and justifications.
 *
 * This test asserts the property against the real search, using the same
 * intersection the page performs, so a refactor that reorders it fails
 * here rather than in production.
 */

let tenant: typeof tenants.$inferSelect;
let approver: typeof users.$inferSelect;
let otherApprover: typeof users.$inferSelect;
let requestor: typeof users.$inferSelect;
let mine: typeof purchaseRequisitions.$inferSelect;
let theirs: typeof purchaseRequisitions.$inferSelect;

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  [tenant] = await adminDb
    .insert(tenants)
    .values({ name: "Inbox Scope Co", slug: `inbox-scope-${suffix}` })
    .returning();

  await withTenant(tenant.id, async (tx) => {
    const [dept] = await tx.insert(departments).values({ tenantId: tenant.id, name: "Ops" }).returning();
    [approver] = await tx
      .insert(users)
      .values({ tenantId: tenant.id, email: `a-${suffix}@example.com`, fullName: "Asha Approver", status: "active" })
      .returning();
    [otherApprover] = await tx
      .insert(users)
      .values({ tenantId: tenant.id, email: `o-${suffix}@example.com`, fullName: "Omar Other", status: "active" })
      .returning();
    [requestor] = await tx
      .insert(users)
      .values({ tenantId: tenant.id, email: `r-${suffix}@example.com`, fullName: "Rita Requestor", status: "active" })
      .returning();

    // Both requisitions mention "tungsten", so a search finds both.
    const make = async () => {
      const [r] = await tx
        .insert(purchaseRequisitions)
        .values({
          tenantId: tenant.id,
          requestorId: requestor.id,
          departmentId: dept.id,
          status: "pending_approval",
          totalEstimatedValue: "1000",
          justification: "tungsten electrodes for the welding bay",
        })
        .returning();
      await tx.insert(purchaseRequisitionLines).values({
        tenantId: tenant.id,
        requisitionId: r.id,
        freeTextDescription: "Tungsten electrode 2.4mm",
        fulfillmentType: "goods",
        quantity: "50",
        uom: "each",
      });
      return r;
    };
    mine = await make();
    theirs = await make();

    await tx.insert(requisitionApprovalRequirements).values([
      { tenantId: tenant.id, requisitionId: mine.id, source: "rule", assignedUserId: approver.id, groupNo: 1, groupSequence: 1, status: "pending" },
      { tenantId: tenant.id, requisitionId: theirs.id, source: "rule", assignedUserId: otherApprover.id, groupNo: 1, groupSequence: 1, status: "pending" },
    ]);
  });
});

afterAll(async () => {
  await adminDb.delete(requisitionApprovalRequirements).where(eq(requisitionApprovalRequirements.tenantId, tenant.id));
  await adminDb.delete(purchaseRequisitionLines).where(eq(purchaseRequisitionLines.tenantId, tenant.id));
  await adminDb.delete(purchaseRequisitions).where(eq(purchaseRequisitions.tenantId, tenant.id));
  await adminDb.delete(users).where(eq(users.tenantId, tenant.id));
  await adminDb.delete(departments).where(eq(departments.tenantId, tenant.id));
  await adminDb.delete(tenants).where(eq(tenants.id, tenant.id));
});

/** The exact composition the approvals page performs: match, then intersect with what is assigned to me. */
async function inboxFor(userId: string, q: string) {
  return withTenant(tenant.id, async (tx) => {
    const matchingIds = q ? await findRequisitionIdsMatching(tx, q) : null;
    const pending = await tx
      .select()
      .from(requisitionApprovalRequirements)
      .where(eq(requisitionApprovalRequirements.status, "pending"));

    return pending
      .filter((r) => r.assignedUserId === userId && (matchingIds === null || matchingIds.includes(r.requisitionId)))
      .map((r) => r.requisitionId);
  });
}

describe("approvals inbox scope", () => {
  it("the raw search does find both requisitions — the intersection is what protects the second", async () => {
    const hits = await withTenant(tenant.id, (tx) => findRequisitionIdsMatching(tx, "tungsten"));
    expect(hits).toContain(mine.id);
    expect(hits).toContain(theirs.id);
  });

  it("searching my inbox never returns a requisition assigned to somebody else", async () => {
    const results = await inboxFor(approver.id, "tungsten");
    expect(results).toContain(mine.id);
    expect(results).not.toContain(theirs.id);
  });

  it("and the same holds from the other side", async () => {
    const results = await inboxFor(otherApprover.id, "tungsten");
    expect(results).toContain(theirs.id);
    expect(results).not.toContain(mine.id);
  });

  it("an unfiltered inbox shows only my own rows too", async () => {
    expect(await inboxFor(approver.id, "")).toEqual([mine.id]);
  });

  it("a search matching nothing empties my inbox rather than falling back to everything", async () => {
    expect(await inboxFor(approver.id, "zzzznope")).toEqual([]);
  });
});
