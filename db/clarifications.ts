import { and, desc, eq, inArray, or } from "drizzle-orm";
import type { db } from "./client";
import { withTenant } from "./withTenant";
import { LIVE_STATUSES, type ClarificationEntityType } from "./clarificationRules";
import { getCurrentUserAndTenant } from "./session";
import { logAction } from "./audit";
import { notifyUser } from "./notifications";
import {
  requisitionApprovalRequirements,
  transactionClarificationMessages,
  transactionClarifications,
  users,
} from "./schema";

/**
 * Transaction clarifications — a question raised ON a record by one user in a
 * customer organisation, answered by another, held open until the person who
 * asked says it is settled.
 *
 * NOT the support desk (db/supportDesk.ts). A clarification never reaches AWA;
 * there is no platform-side view of this table at all. Both parties are tenant
 * users with users rows, which is why this writes to the existing audit_log
 * while the support desk had to build its own events table.
 *
 * See docs/transaction-clarifications-plan.md.
 */

// =========================================================================
// Reading
// =========================================================================

export async function listForEntity(entityType: ClarificationEntityType, entityId: string) {
  const { user, tenant } = await getCurrentUserAndTenant();

  return withTenant(tenant.id, async (tx) => {
    const rows = await tx
      .select({
        clarification: transactionClarifications,
        raisedByName: users.fullName,
      })
      .from(transactionClarifications)
      .innerJoin(users, eq(users.id, transactionClarifications.raisedByUserId))
      .where(
        and(
          eq(transactionClarifications.entityType, entityType),
          eq(transactionClarifications.entityId, entityId),
        ),
      )
      .orderBy(desc(transactionClarifications.createdAt));

    if (rows.length === 0) return { rows: [], messagesByClarification: {}, viewerId: user.id };

    const ids = rows.map((r) => r.clarification.id);
    const messages = await tx
      .select({
        message: transactionClarificationMessages,
        authorName: users.fullName,
      })
      .from(transactionClarificationMessages)
      .innerJoin(users, eq(users.id, transactionClarificationMessages.authorUserId))
      .where(inArray(transactionClarificationMessages.clarificationId, ids))
      .orderBy(transactionClarificationMessages.createdAt);

    const messagesByClarification: Record<string, typeof messages> = {};
    for (const m of messages) {
      (messagesByClarification[m.message.clarificationId] ??= []).push(m);
    }

    return { rows, messagesByClarification, viewerId: user.id };
  });
}

/** Personal inbox — what stops queries dying inside a record nobody revisits. */
export async function listMyQueries() {
  const { user, tenant } = await getCurrentUserAndTenant();

  return withTenant(tenant.id, async (tx) => {
    const askedOfMe = await tx
      .select({ clarification: transactionClarifications, counterpartName: users.fullName })
      .from(transactionClarifications)
      .innerJoin(users, eq(users.id, transactionClarifications.raisedByUserId))
      .where(
        and(
          eq(transactionClarifications.assignedToUserId, user.id),
          inArray(transactionClarifications.status, LIVE_STATUSES),
        ),
      )
      .orderBy(desc(transactionClarifications.createdAt));

    const iAsked = await tx
      .select({ clarification: transactionClarifications, counterpartName: users.fullName })
      .from(transactionClarifications)
      .leftJoin(users, eq(users.id, transactionClarifications.assignedToUserId))
      .where(eq(transactionClarifications.raisedByUserId, user.id))
      .orderBy(desc(transactionClarifications.createdAt));

    return { askedOfMe, iAsked, viewerId: user.id };
  });
}

// =========================================================================
// Writing
// =========================================================================

/**
 * May this user hold up this record?
 *
 * Only someone the record is actually waiting on — for a requisition, a
 * pending approver. Otherwise any user could freeze any record. A user who
 * isn't eligible can still ask; the query just doesn't block.
 */
async function mayBlock(
  tx: typeof db,
  tenantId: string,
  userId: string,
  entityType: ClarificationEntityType,
  entityId: string,
): Promise<boolean> {
  if (entityType !== "requisition") return false;

  const pending = await tx
    .select({ id: requisitionApprovalRequirements.id })
    .from(requisitionApprovalRequirements)
    .where(
      and(
        eq(requisitionApprovalRequirements.tenantId, tenantId),
        eq(requisitionApprovalRequirements.requisitionId, entityId),
        eq(requisitionApprovalRequirements.assignedUserId, userId),
        eq(requisitionApprovalRequirements.status, "pending"),
      ),
    )
    .limit(1);

  return pending.length > 0;
}

export async function raiseClarification(input: {
  entityType: ClarificationEntityType;
  entityId: string;
  question: string;
  assignedToUserId?: string | null;
  blocksProgress?: boolean;
}) {
  const { user, tenant } = await getCurrentUserAndTenant();
  const question = input.question.trim();
  if (!question) throw new Error("A query needs a question.");

  return withTenant(tenant.id, async (tx) => {
    const wantsBlock = input.blocksProgress === true;
    const blocksProgress =
      wantsBlock && (await mayBlock(tx, tenant.id, user.id, input.entityType, input.entityId));

    const [clarification] = await tx
      .insert(transactionClarifications)
      .values({
        tenantId: tenant.id,
        entityType: input.entityType,
        entityId: input.entityId,
        raisedByUserId: user.id,
        assignedToUserId: input.assignedToUserId || null,
        question,
        blocksProgress,
      })
      .returning();

    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "clarification.raised",
      entityType: "clarification",
      entityId: clarification.id,
      metadata: {
        onEntityType: input.entityType,
        onEntityId: input.entityId,
        blocksProgress,
        blockRequestedButNotPermitted: wantsBlock && !blocksProgress,
      },
    });

    if (clarification.assignedToUserId) {
      await notifyUser(
        tx,
        clarification.assignedToUserId,
        "clarification_raised",
        `${user.fullName} asked you a question`,
        question,
      );
    }

    return clarification;
  });
}

export async function replyToClarification(clarificationId: string, body: string) {
  const { user, tenant } = await getCurrentUserAndTenant();
  const text = body.trim();
  if (!text) throw new Error("A reply cannot be empty.");

  await withTenant(tenant.id, async (tx) => {
    const [clarification] = await tx
      .select()
      .from(transactionClarifications)
      .where(eq(transactionClarifications.id, clarificationId))
      .limit(1);

    if (!clarification) throw new Error("Query not found.");
    if (clarification.status === "withdrawn") throw new Error("This query was withdrawn.");

    await tx.insert(transactionClarificationMessages).values({
      tenantId: tenant.id,
      clarificationId,
      authorUserId: user.id,
      body: text,
    });

    // A reply from anyone other than the asker is an answer. The asker's own
    // follow-up is a nudge, not an answer — it must not flip the state to
    // 'answered' and make the query look handled.
    const isAnswer = clarification.raisedByUserId !== user.id;

    if (isAnswer && clarification.status !== "answered") {
      await tx
        .update(transactionClarifications)
        .set({ status: "answered", answeredAt: new Date() })
        .where(eq(transactionClarifications.id, clarificationId));
    }

    // A reply after resolution reopens it. Unlike a support ticket there is no
    // time limit: a record's history is permanent and a late correction on an
    // invoice query is legitimate.
    if (clarification.status === "resolved") {
      await tx
        .update(transactionClarifications)
        .set({ status: "answered", resolvedAt: null, resolvedByUserId: null })
        .where(eq(transactionClarifications.id, clarificationId));
    }

    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: isAnswer ? "clarification.answered" : "clarification.commented",
      entityType: "clarification",
      entityId: clarificationId,
      metadata: { reopened: clarification.status === "resolved" },
    });

    const notifyTarget = isAnswer ? clarification.raisedByUserId : clarification.assignedToUserId;
    if (notifyTarget && notifyTarget !== user.id) {
      await notifyUser(
        tx,
        notifyTarget,
        "clarification_answered",
        `${user.fullName} replied to a query`,
        text,
      );
    }
  });
}

/**
 * Only the asker can resolve — the whole meaning of "held open until
 * resolved". The DB check constraint enforces it too; this is the friendlier
 * of the two errors, and the one that survives if the constraint is ever
 * dropped by accident is the constraint, not this.
 */
export async function resolveClarification(clarificationId: string) {
  const { user, tenant } = await getCurrentUserAndTenant();

  await withTenant(tenant.id, async (tx) => {
    const [clarification] = await tx
      .select()
      .from(transactionClarifications)
      .where(eq(transactionClarifications.id, clarificationId))
      .limit(1);

    if (!clarification) throw new Error("Query not found.");
    if (clarification.raisedByUserId !== user.id) {
      throw new Error("Only the person who asked this can resolve it.");
    }
    if (clarification.status === "resolved") return;

    // C4: resolving an empty thread is almost always a mis-click.
    const replies = await tx
      .select({ id: transactionClarificationMessages.id })
      .from(transactionClarificationMessages)
      .where(eq(transactionClarificationMessages.clarificationId, clarificationId))
      .limit(1);
    if (replies.length === 0) {
      throw new Error("Nobody has answered yet — withdraw the query instead if it no longer applies.");
    }

    await tx
      .update(transactionClarifications)
      .set({ status: "resolved", resolvedAt: new Date(), resolvedByUserId: user.id })
      .where(eq(transactionClarifications.id, clarificationId));

    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "clarification.resolved",
      entityType: "clarification",
      entityId: clarificationId,
      metadata: { unblocked: clarification.blocksProgress },
    });

    if (clarification.assignedToUserId && clarification.assignedToUserId !== user.id) {
      await notifyUser(
        tx,
        clarification.assignedToUserId,
        "clarification_resolved",
        `${user.fullName} closed their query`,
        clarification.question,
      );
    }
  });
}

export async function withdrawClarification(clarificationId: string) {
  const { user, tenant } = await getCurrentUserAndTenant();

  await withTenant(tenant.id, async (tx) => {
    const [clarification] = await tx
      .select()
      .from(transactionClarifications)
      .where(eq(transactionClarifications.id, clarificationId))
      .limit(1);

    if (!clarification) throw new Error("Query not found.");
    if (clarification.raisedByUserId !== user.id) {
      throw new Error("Only the person who asked this can withdraw it.");
    }

    await tx
      .update(transactionClarifications)
      .set({ status: "withdrawn" })
      .where(eq(transactionClarifications.id, clarificationId));

    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "clarification.withdrawn",
      entityType: "clarification",
      entityId: clarificationId,
      metadata: {},
    });
  });
}

/** Candidate assignees for a query: active users in the tenant. */
export async function listAssignableUsers() {
  const { tenant } = await getCurrentUserAndTenant();
  return withTenant(tenant.id, async (tx) =>
    tx
      .select({ id: users.id, fullName: users.fullName, email: users.email })
      .from(users)
      .where(and(eq(users.tenantId, tenant.id), or(eq(users.status, "active"), eq(users.status, "invited"))))
      .orderBy(users.fullName),
  );
}
