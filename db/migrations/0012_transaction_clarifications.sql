-- 0012_transaction_clarifications.sql
-- Transaction clarifications (docs/transaction-clarifications-plan.md) — a
-- question raised ON a record (requisition, PO, invoice, goods receipt,
-- quotation) by one user in a customer organisation, answered by another,
-- held open until the person who asked says it is settled.
--
-- This finishes an intent already in the schema: approval_action has carried
-- a 'commented' value since 0001_init.sql and nothing ever used it. That enum
-- value stays unused — approval_decision_log is keyed to a single approval
-- requirement and is append-only, so it can host neither a PO/invoice query
-- nor a mutable resolved state.
--
-- NOT the support desk (0011). A clarification never reaches AWA.

-- =========================================================================
-- Enums
-- =========================================================================

-- The record types a query can hang off. A constrained enum is what makes the
-- (entity_type, entity_id) pair safe without a foreign key: it cannot point at
-- an arbitrary table.
create type clarification_entity_type as enum (
  'requisition', 'purchase_order', 'invoice', 'goods_receipt', 'quotation'
);

create type clarification_status as enum ('open', 'answered', 'resolved', 'withdrawn');

-- =========================================================================
-- Clarifications
-- =========================================================================

create table transaction_clarifications (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id),

  entity_type           clarification_entity_type not null,
  entity_id             uuid not null,

  raised_by_user_id     uuid not null references users(id),
  -- null = addressed to anyone who can see the record.
  assigned_to_user_id   uuid references users(id),
  question              text not null,
  status                clarification_status not null default 'open',

  -- When true and the status is open/answered, the record's primary action is
  -- held. Deliberately NOT a status on the record itself: "blocked" is a
  -- property of there existing an open question, so deriving it means it can
  -- never go stale and no code path can forget to clear it. Adding an
  -- 'on_hold' value to requisition_status would instead ripple through the
  -- approval engine, the lifecycle tracker and the golden-path test.
  blocks_progress       boolean not null default false,

  answered_at           timestamptz,
  resolved_at           timestamptz,
  resolved_by_user_id   uuid references users(id),
  -- Set when a query turns out to be a product defect and is promoted into a
  -- support ticket. One-way: nothing flows back from the ticket, so an AWA
  -- agent's words never land in a record's permanent history.
  escalated_ticket_id   uuid references support_tickets(id),

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- Only the asker can resolve. This is the whole meaning of "held open until
  -- resolved": the person who needs the answer decides when they have it. If
  -- the answerer could close it, 'resolved' would degrade into "someone typed
  -- something", which is how every comment thread that pretends to be a
  -- workflow fails. Enforced here, where no server action can bypass it.
  constraint clarification_resolved_by_asker check (
    status <> 'resolved'
    or (resolved_by_user_id is not null and resolved_by_user_id = raised_by_user_id)
  ),
  constraint clarification_resolved_has_timestamp check (
    status <> 'resolved' or resolved_at is not null
  )
);

create index on transaction_clarifications (tenant_id, entity_type, entity_id, status);
create index on transaction_clarifications (tenant_id, assigned_to_user_id, status);
create index on transaction_clarifications (tenant_id, raised_by_user_id, status);

alter table transaction_clarifications enable row level security;
create policy tenant_isolation on transaction_clarifications
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());

-- =========================================================================
-- Messages
-- =========================================================================
-- One author column, no visibility column, no is_question flag. Everyone who
-- can see the record sees every message — there are no private lanes here,
-- because everyone in the thread is on the same side. That single-column
-- simplicity is the clearest structural signal that this is not the support
-- desk, whose messages table needs two author columns and a visibility enum.

create table transaction_clarification_messages (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id),
  clarification_id   uuid not null references transaction_clarifications(id) on delete cascade,
  author_user_id     uuid not null references users(id),
  body               text not null,
  created_at         timestamptz not null default now()
);

create index on transaction_clarification_messages (tenant_id, clarification_id, created_at);

alter table transaction_clarification_messages enable row level security;
create policy tenant_isolation on transaction_clarification_messages
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());

-- =========================================================================
-- updated_at maintenance
-- =========================================================================
create trigger set_updated_at before update on transaction_clarifications
  for each row execute function app.set_updated_at();
