-- 0018_support_polish.sql
-- Support desk Phase D (docs/support-desk-plan.md §10), items 1–4:
-- console error capture, saved replies, CSAT, per-tenant SLA overrides.
--
-- Items 5–7 are deliberately not here: business-hours calendars the plan
-- already defers, the weekly digest would be dead on arrival while no email
-- provider is configured in production, and vendor-portal reporting is a
-- different auth model entirely.

-- =========================================================================
-- 1. Console error capture
-- =========================================================================
-- A ring buffer of the last handful of window.onerror / unhandledrejection
-- entries, captured client-side and attached to a bug report. jsonb rather
-- than a child table: it is written once at report time, read as a whole, and
-- never queried across tickets — a table would buy nothing.
--
-- What goes in here is deliberately narrow (message, source, line, timestamp)
-- and the message is truncated app-side. An uncaught error message can quote
-- application data, and this app holds bank details and vendor pricing — so
-- the report form tells the user this is being attached rather than gathering
-- it silently.
alter table support_tickets
  add column console_errors jsonb;

-- =========================================================================
-- 3. CSAT
-- =========================================================================
create type support_csat_rating as enum ('positive', 'negative');

alter table support_tickets
  add column csat_rating   support_csat_rating,
  add column csat_comment  text,
  add column csat_at       timestamptz;

-- A rating without a timestamp (or the reverse) would make "did they answer?"
-- unanswerable, which is the only question this data exists to answer.
alter table support_tickets
  add constraint support_csat_complete check (
    (csat_rating is null and csat_at is null) or (csat_rating is not null and csat_at is not null)
  );

-- =========================================================================
-- 2. Saved replies
-- =========================================================================
-- Platform-level: these are AWA's canned answers, not a customer's. No
-- tenant_id, so no RLS — same shape as support_agents and support_sla_policies.
create table support_saved_replies (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  body          text not null,
  -- Empty = offer this reply for every ticket type.
  applies_to    support_ticket_type[] not null default '{}',
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (title)
);

create index on support_saved_replies (active);

create trigger set_updated_at before update on support_saved_replies
  for each row execute function app.set_updated_at();

insert into support_saved_replies (title, body, applies_to) values
  (
    'Ask for reproduction steps',
    E'Thanks for reporting this.\n\nSo we can reproduce it: what were you doing immediately before it happened, what did you expect to see, and what appeared instead? A screenshot of the moment it goes wrong helps more than anything else.',
    '{bug}'
  ),
  (
    'Confirm a fix has shipped',
    E'This is fixed and live now.\n\nPlease give it another try when you get a moment — if it still misbehaves, reopen this ticket and we will pick it straight back up.',
    '{bug}'
  ),
  (
    'Feature request acknowledged',
    E'Thanks — this is a fair ask and we have logged it.\n\nWe do not put a delivery date on feature requests, because committing to one we then miss is worse than being straight with you. We will come back to this ticket when it moves.',
    '{feature_request}'
  ),
  (
    'Thanks for the feedback',
    E'Thank you — this is genuinely useful, and it has gone to the people who decide what we build next.',
    '{feedback}'
  );

-- =========================================================================
-- 4. Per-tenant SLA overrides
-- =========================================================================
-- TENANT-SCOPED, unlike support_sla_policies. This is the shape §2 of the plan
-- called for: a negotiated SLA belongs to one customer, so it gets its own
-- tenant_id column and its own RLS policy, rather than a nullable tenant_id on
-- the global table — where a NULL would have made the default row invisible to
-- everyone, since the policy compares tenant_id to app.current_tenant_id().
--
-- RLS written by hand: the generic do-block in 0001_init.sql only ran once and
-- does not cover tables added later.
create table support_sla_overrides (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references tenants(id) on delete cascade,
  ticket_type             support_ticket_type not null,
  priority                support_ticket_priority not null,
  first_response_minutes  integer not null,
  -- NULL is meaningful here too: an override can remove a resolution target
  -- that the global policy sets.
  resolution_minutes      integer,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  unique (tenant_id, ticket_type, priority),
  constraint sla_override_first_response_positive check (first_response_minutes > 0),
  constraint sla_override_resolution_positive check (resolution_minutes is null or resolution_minutes > 0)
);

create index on support_sla_overrides (tenant_id, ticket_type, priority);

alter table support_sla_overrides enable row level security;
create policy tenant_isolation on support_sla_overrides
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());

create trigger set_updated_at before update on support_sla_overrides
  for each row execute function app.set_updated_at();
