# Transaction clarifications — design & build plan

A query raised **on a record** — a requisition, PO, invoice, goods receipt, quotation — by
one user in a customer organisation, answered by another, and held open until the person
who asked says it's settled.

This is **not** the support desk. See [support-desk-plan.md](support-desk-plan.md) §3.1 for
the boundary; the one-line version is below.

> **Status: Phases A and B built** (branch `feat/support-desk-and-clarifications`).
> Migration `0015_transaction_clarifications.sql` is applied to the dev database. The
> Queries panel is live on the approvals inbox, `/dashboard/queries` is the personal
> inbox, and blocking works end to end — including server-side enforcement in
> `approveRequirement` and `reject`, not just the disabled fieldset.
> Phase C (other record types, promotion to a support ticket, ageing nudges) is not
> started; `transaction_clarifications.escalated_ticket_id` exists but nothing sets it.
>
> Decisions **C1**–**C4** are all implemented as recommended.

---

## 1. What this is, and what it replaces

Today an approver looking at a requisition has exactly three moves: approve, reject-revisable,
or reject-closed. There is no way to *ask a question*.

So the approver who wants to know "is this the Packaging cost centre or Maintenance?" has to
either reject the requisition — which is a heavy, visible, morale-costing act for a
one-line question — or leave the app entirely and ask on WhatsApp, which is precisely the
process this platform was built to replace (README, opening line).

A clarification is the missing lightweight move. It asks a question **without** changing the
record's status, and it holds the decision until answered.

### The boundary, in one rule

**Is the answer inside your organisation, or inside our product?**

| | Transaction clarification | Support ticket |
|---|---|---|
| Asked about | A record | The application |
| Answered by | A colleague | AWA support |
| AWA sees it | Never | Always |
| Can block an approval | Yes | No |

The systems share nothing — not a table, not an enum, not a status model. The only
connection is a one-way promotion (§7).

---

## 2. What already exists

Grounded in the repo as it stands, not assumed:

| Finding | Consequence |
|---|---|
| `approvalAction` enum already includes `"commented"` ([db/schema.ts:43](../db/schema.ts)), and it is **used nowhere** in the codebase. | The schema anticipated this feature and nothing implemented it — same as `service_milestones` and `vendor_returns` before their sprints. This plan is finishing an intent already in the schema, not inventing one. |
| `approval_decision_log` is keyed to `requisition_approval_requirement_id` — it is approval-specific, not record-general. | It cannot host clarifications on a PO or an invoice. A general table is needed. |
| `approval_decision_log` has `update`/`delete` revoked from `app_runtime` ([0003_app_role.sql:27](../db/migrations/0003_app_role.sql)) — it is append-only. | It cannot carry a mutable `resolved` state. Second reason for a separate table. |
| Both parties to a clarification are tenant users with `users` rows. | Clarifications write to the existing **`audit_log`** via `logAction`. This is exactly the constraint that forced the support desk to build its own events table — here it does not apply. |
| `requisitionStatus` has no "on hold" value, and adding one would ripple through the approval engine, the lifecycle tracker and the golden-path test. | A blocking clarification must **not** change the requisition's status. §4 handles this without touching the enum. |
| Notifications (`notifyUser`) and Web Push already resolve a `users` row. | Clarification notifications work today, with no email provider dependency — unlike the support desk. |

---

## 3. Lifecycle

Four states. The distinguishing rule is who may make each move.

```
   open ──▶ answered ──▶ resolved
     │          │
     └──────────┴──▶ withdrawn
```

| State | Meaning | Who can set it |
|---|---|---|
| `open` | Asked, nobody has replied | system, on create |
| `answered` | Someone replied; the asker hasn't accepted yet | system, on first reply from anyone other than the asker |
| `resolved` | The asker is satisfied | **the asker only** |
| `withdrawn` | No longer needed | the asker only |

**Only the asker can resolve.** This is the whole meaning of "held open until resolved" — the
person who needs the answer decides when they have it, not the person who supplied it. If the
answerer could close it, "resolved" would degrade into "someone typed something", which is the
failure mode of every comment thread that pretends to be a workflow.

A reply after `resolved` reopens to `answered`. There is no time limit; unlike a support
ticket, a record's history is permanent and a late correction on an invoice query is
legitimate.

---

## 4. Blocking: the part that makes this procurement software

A clarification carries `blocks_progress`. When true and the state is `open` or `answered`,
the record's primary action is held.

**This does not change the record's status.** A requisition with an open blocking query stays
`pending_approval`. What changes is the approval UI: the approve/reject buttons are disabled
with the reason stated inline, and the approvals inbox shows a "1 open query" chip on the row.

Not adding an `on_hold` status is the single most important restraint in this design:

- `requisitionStatus` is consumed by the approval engine, the lifecycle tracker, the golden-path
  test and the invoice-match path. A new value means touching all of them.
- "Blocked" isn't a property of the requisition — it's a property of *there existing an open
  question*. Deriving it (`exists(open blocking clarification)`) means it can never go stale, and
  no code path can forget to clear it.

Same reasoning as the support desk's derive-don't-store rule on SLA breach.

**Who may raise a blocking query:** only a user whose action the record is currently waiting
on — a pending approver on a requisition, the finance user on an invoice in exception. Anyone
else can raise a non-blocking one. Otherwise any user could freeze any record.

**Auto-unblock:** when the asker resolves, the block lifts in the same transaction. There is no
separate "unblock" action to forget.

---

## 5. Data model

Two tenant-scoped tables. RLS policies written by hand in the migration — the generic `do $$`
block in `0001_init.sql` does not re-run for later tables (see `0009_push_subscriptions.sql`).

### 5.1 `transaction_clarifications`

```sql
id                    uuid pk
tenant_id             uuid not null references tenants(id)

entity_type           clarification_entity_type not null
   -- requisition | purchase_order | invoice | goods_receipt | quotation
entity_id             uuid not null

raised_by_user_id     uuid not null references users(id)
assigned_to_user_id   uuid references users(id)   -- null = open to anyone who can see the record
question              text not null
status                clarification_status not null default 'open'
blocks_progress       boolean not null default false

answered_at           timestamptz
resolved_at           timestamptz
resolved_by_user_id   uuid references users(id)
created_at, updated_at

check (status <> 'resolved' or resolved_by_user_id = raised_by_user_id)
index on (tenant_id, entity_type, entity_id, status)
index on (tenant_id, assigned_to_user_id, status)
```

The `check` constraint enforces "only the asker resolves" **in the database**, not in a server
action. It is the same discipline as the support desk's author/visibility constraint: the rule
that matters most is the one a future code path cannot bypass.

`entity_type` + `entity_id` is a deliberate polymorphic reference with no FK. The alternative —
five nullable FK columns — would mean five `check` constraints to keep exactly one populated,
and a sixth migration every time a record type is added. The index carries the lookup;
`entity_type` is a constrained enum, so the pair can't point at an arbitrary table.

### 5.2 `transaction_clarification_messages`

```sql
id, tenant_id
clarification_id  uuid not null references transaction_clarifications(id)
author_user_id    uuid not null references users(id)
body              text not null
created_at
```

One author column, no visibility column, no `is_question` flag. Everyone who can see the record
can see every message — there are no private lanes here, because everyone in the thread is on
the same side. That single-column simplicity is the clearest structural signal that this is not
the support desk.

### 5.3 Audit

Clarifications write to the **existing `audit_log`** via `logAction`, inside the same
transaction as the mutation:

`clarification.raised` · `clarification.answered` · `clarification.resolved` ·
`clarification.withdrawn` · `clarification.escalated_to_support`

with `entityType = 'clarification'`. No new events table — both actors have `users` rows, so
`audit_log.actor_user_id` accepts them. This is the concrete pay-off of keeping the two systems
apart: the support desk needed its own append-only table precisely because platform admins
don't have `users` rows, and that cost is not paid twice.

---

## 6. Where it appears

**On every record page** — a *Queries* panel below the line items:

- open queries first, each with question, asker, who it's addressed to, age, and a blocking flag
- resolved ones collapsed behind a count
- *Ask a question* button; the blocking checkbox appears only for a user whose action is pending

**On the approvals inbox** — a query chip on any row with an open query, and the
approve/reject controls disabled with the reason inline where one blocks.

**`/dashboard/queries`** — a personal inbox with two tabs: *Asked of me* (the actionable one,
default) and *I asked*. This is what stops queries dying in a record nobody revisits.

**Notification** — `notifyUser` + Web Push to the assignee on raise and on reply, to the asker
on answer. Works today; no email-provider dependency.

---

## 7. Promotion to a support ticket

The one connection between the systems, and it is one-way.

A clarification whose answer turns out to be "this is broken" gets an **Escalate to AWA support**
action, available to the asker or a tenant admin. It:

1. creates a `support_ticket` with `type = 'bug'`, pre-filling `related_entity_type` /
   `related_entity_id` from the clarification and the question as the description
2. copies the clarification thread into the ticket's opening message as quoted context —
   a **copy**, not a live link, so later internal discussion on the record never leaks to AWA
3. writes `clarification.escalated_to_support` to `audit_log` and stores the ticket reference
   on the clarification for display

Nothing flows back. A support reply does not post into the clarification thread — the customer
decides what to relay. Without that, an AWA agent's words would appear inside a record's
permanent audit history, which is not a thing anyone signed up for.

---

## 8. Testing

Extend `rls-isolation.test.ts` with both new tables — a clarification on tenant A's requisition
must be invisible to tenant B, same launch-blocker standard as everything else tenant-scoped.

New `db/__tests__/clarifications.test.ts`:

| Test | Why |
|---|---|
| **Only the asker can resolve** — the answerer's attempt is rejected by the `check` constraint | The core rule of "open till resolved", enforced where it can't be bypassed |
| An open blocking query prevents approval; resolving it permits approval in the same transaction | The blocking mechanism, including auto-unblock |
| A requisition with an open blocking query is still `pending_approval` | Proves no status was invented; guards the approval engine and golden-path test |
| A non-pending user cannot raise a blocking query | Otherwise anyone can freeze any record |
| A reply after `resolved` reopens to `answered` | Late corrections are legitimate on a permanent record |
| Escalation creates a ticket carrying the record reference, and the two threads stay independent | The one-way boundary actually holds |

---

## 9. Build phases

Branch + PR per the AGENTS.md shipping policy.

**Phase A — Ask and answer.** Migration (2 tables, 2 enums, RLS, the resolve constraint),
`db/clarifications.ts`, the Queries panel on requisition and invoice pages, `/dashboard/queries`
inbox, notifications, `audit_log` wiring, tests. Non-blocking only.

**Phase B — Blocking.** `blocks_progress`, the eligibility rule, disabled approval controls with
inline reason, the approvals-inbox chip, auto-unblock.

**Phase C — Reach and promotion.** Remaining record types (PO, GRN, quotation), escalation to a
support ticket, ageing nudges on open blocking queries.

**Deliberately deferred:** attachments on clarifications (they reuse the support desk's R2 route
handler and key layout once that exists — no second upload path), @-mentions, per-query TAT and
escalation matrices, and any customer-side private lane.

---

## 10. Open decisions

**C1 — Can a clarification be raised on a `draft` requisition?** → **Recommend no.** Before
submission the requester can simply edit the record. Queries start at `submitted`.

**C2 — Who can see a clarification?** → **Recommend: anyone who can see the record.** A query and
its answer are part of why a record looks the way it does. Restricting them to asker and
assignee would reproduce, inside the app, the WhatsApp side-channel this replaces.

**C3 — Does an unanswered blocking query expire?** → **Recommend no expiry, with a nudge at 48h**
and escalation to the requester's manager left to Phase C. Auto-resolving a question nobody
answered would silently release a held approval, which is the worst possible failure here.

**C4 — Does resolving require an explicit answer message?** → **Recommend yes** — resolving with
an empty thread is almost always a mis-click. A one-word "confirmed" is fine; nothing is not.
