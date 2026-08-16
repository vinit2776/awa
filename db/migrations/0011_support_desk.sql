-- 0011_support_desk.sql
-- Support desk (docs/support-desk-plan.md) — customers report bugs, feature
-- requests and feedback from inside the app; a platform-side support team
-- triages, responds and resolves.
--
-- NOT the transaction clarification system (0012). A support ticket is a
-- question about the product, asked of AWA. A clarification is a question
-- about a record, asked of a colleague. They share no table, no enum and no
-- status model — see docs/support-desk-plan.md §3.1.
--
-- Note on RLS: the generic `do $$` block in 0001_init.sql that enabled RLS on
-- every tenant_id-carrying table ran once, at init. It does NOT re-run for
-- tables added later, so every policy below is written by hand — same as
-- 0009_push_subscriptions.sql. A tenant-scoped table without an explicit
-- policy here would be readable by every tenant.

-- =========================================================================
-- Enums
-- =========================================================================

create type support_ticket_type as enum ('bug', 'feature_request', 'feedback', 'question');

create type support_ticket_status as enum (
  'new', 'triaged', 'in_progress', 'awaiting_customer', 'resolved', 'closed'
);

create type support_ticket_priority as enum ('urgent', 'high', 'normal', 'low');

-- Resolution reasons are a separate field, not statuses. Keeping them out of
-- support_ticket_status is what stops that enum growing to fifteen values.
create type support_resolution_outcome as enum (
  'fixed', 'shipped', 'wont_do', 'duplicate', 'not_a_bug', 'no_response'
);

-- 'support_only', not 'internal'. With three participant classes in play
-- (reporter, their colleagues, AWA support) "internal" does not say internal
-- to whom — a future reader could take it as "internal to the customer's
-- organisation" and build the wrong thing on it.
create type support_message_visibility as enum ('customer', 'support_only');

create type support_actor_kind as enum ('customer', 'support', 'system');

-- =========================================================================
-- Reference numbering
-- =========================================================================
-- Global, not per-tenant. Support staff work a cross-tenant queue and two
-- customers both holding a "Ticket 7" is a standing source of mistakes. The
-- only leak is total platform ticket volume, which is not sensitive.
create sequence support_ticket_ref_seq;

-- =========================================================================
-- Tickets
-- =========================================================================

create table support_tickets (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references tenants(id),
  reference               text not null unique
                            default ('SUP-' || lpad(nextval('support_ticket_ref_seq')::text, 5, '0')),

  type                    support_ticket_type not null,
  status                  support_ticket_status not null default 'new',
  priority                support_ticket_priority not null default 'normal',
  subject                 text not null,
  description             text not null,
  reported_by_user_id     uuid not null references users(id),

  -- Context captured at report time. Snapshot, not a join: the browser the
  -- reporter is using *now* is useless for reproducing a three-week-old bug.
  page_path               text,
  page_url                text,
  related_entity_type     text,
  related_entity_id       uuid,
  app_version             text,
  user_agent              text,
  viewport                text,

  -- Assignment. platform_admins carries no tenant_id (it is outside RLS
  -- entirely), so this FK deliberately crosses out of the tenant scope.
  assigned_to_admin_id    uuid references platform_admins(id),
  assigned_at             timestamptz,

  -- TAT. Phase A stores the columns but leaves them null; Phase B populates
  -- them from support_sla_policies. Breach is always derived, never stored.
  first_response_due_at   timestamptz,
  resolution_due_at       timestamptz,
  first_responded_at      timestamptz,
  resolved_at             timestamptz,
  closed_at               timestamptz,
  resolution_outcome      support_resolution_outcome,
  resolution_summary      text,
  escalation_level        integer not null default 0,
  escalated_at            timestamptz,
  customer_escalated_at   timestamptz,

  related_ticket_id       uuid references support_tickets(id),

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  -- A resolution must say what the outcome was and explain it. The summary is
  -- customer-visible; it is the thing that makes a support system feel honest
  -- rather than a black hole.
  constraint support_tickets_resolution_complete check (
    status not in ('resolved', 'closed')
    or (resolution_outcome is not null and resolution_summary is not null)
  )
);

create index on support_tickets (tenant_id, status);
create index on support_tickets (tenant_id, reported_by_user_id);
create index on support_tickets (assigned_to_admin_id, status);
create index on support_tickets (status, resolution_due_at);

alter table support_tickets enable row level security;
create policy tenant_isolation on support_tickets
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());

-- =========================================================================
-- Messages — the ticket thread
-- =========================================================================

create table support_ticket_messages (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references tenants(id),
  ticket_id                 uuid not null references support_tickets(id) on delete cascade,
  visibility                support_message_visibility not null default 'customer',
  body                      text not null,
  -- Drives the status: a support reply flagged as a question moves the ticket
  -- to awaiting_customer, and the customer's reply moves it back. Nobody has
  -- to remember to flip a status by hand.
  is_question               boolean not null default false,
  author_user_id            uuid references users(id),
  author_platform_admin_id  uuid references platform_admins(id),
  created_at                timestamptz not null default now(),

  constraint support_message_single_author check (
    num_nonnulls(author_user_id, author_platform_admin_id) = 1
  ),
  -- Load-bearing: makes "a customer wrote a support-only note" impossible at
  -- the database level, not merely unlikely in the UI. A support agent's
  -- private note and a customer's reply travel the same table, so the
  -- constraint — not a server action, not a UI guard — is what keeps the
  -- lanes apart.
  constraint support_message_support_only_authorship check (
    visibility <> 'support_only' or author_platform_admin_id is not null
  )
);

create index on support_ticket_messages (tenant_id, ticket_id, created_at);

alter table support_ticket_messages enable row level security;
create policy tenant_isolation on support_ticket_messages
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());

-- =========================================================================
-- Attachments
-- =========================================================================
-- storage_key layout: support/<tenant_id>/<ticket_id>/<attachment_id>.<ext>
-- The tenant id in the path means a leaked key still cannot cross tenants
-- without also passing the row check.

create table support_ticket_attachments (
  id                            uuid primary key default gen_random_uuid(),
  tenant_id                     uuid not null references tenants(id),
  ticket_id                     uuid not null references support_tickets(id) on delete cascade,
  message_id                    uuid references support_ticket_messages(id) on delete cascade,
  storage_key                   text not null unique,
  file_name                     text not null,
  content_type                  text not null,
  size_bytes                    integer not null,
  uploaded_by_user_id           uuid references users(id),
  uploaded_by_platform_admin_id uuid references platform_admins(id),
  created_at                    timestamptz not null default now(),

  constraint support_attachment_single_uploader check (
    num_nonnulls(uploaded_by_user_id, uploaded_by_platform_admin_id) = 1
  )
);

create index on support_ticket_attachments (tenant_id, ticket_id);

alter table support_ticket_attachments enable row level security;
create policy tenant_isolation on support_ticket_attachments
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());

-- =========================================================================
-- Events — the ticket audit trail
-- =========================================================================
-- Deliberately NOT audit_log. audit_log.actor_user_id references users(id),
-- and a platform support admin has no users row — so support actions cannot
-- be written there at all. Transaction clarifications (0012) have the
-- opposite property and do use audit_log.

create table support_ticket_events (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references tenants(id),
  ticket_id                 uuid not null references support_tickets(id) on delete cascade,
  event                     text not null,
  actor_kind                support_actor_kind not null,
  actor_user_id             uuid references users(id),
  actor_platform_admin_id   uuid references platform_admins(id),
  from_value                text,
  to_value                  text,
  metadata                  jsonb not null default '{}',
  occurred_at               timestamptz not null default now(),

  -- 'system' events have no actor; the other two kinds must have exactly one.
  constraint support_event_actor_matches_kind check (
    (actor_kind = 'system'   and num_nonnulls(actor_user_id, actor_platform_admin_id) = 0)
    or (actor_kind = 'customer' and actor_user_id is not null and actor_platform_admin_id is null)
    or (actor_kind = 'support'  and actor_platform_admin_id is not null and actor_user_id is null)
  )
);

create index on support_ticket_events (tenant_id, ticket_id, occurred_at);

alter table support_ticket_events enable row level security;
create policy tenant_isolation on support_ticket_events
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());

-- Append-only, same discipline as audit_log and approval_decision_log
-- (0003_app_role.sql). An audit trail the application can rewrite is not one.
revoke update, delete on support_ticket_events from app_runtime;

-- =========================================================================
-- updated_at maintenance
-- =========================================================================
-- The generic do-block in 0001_init.sql only covered tables that existed then.
create trigger set_updated_at before update on support_tickets
  for each row execute function app.set_updated_at();
