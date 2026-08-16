-- 0016_support_routing_and_tat.sql
-- Support desk Phase B (docs/support-desk-plan.md §7, §8, §10): auto-assignment
-- and the TAT clock. Phase A shipped the columns for due dates and left them
-- null; this fills them and adds the routing tables that decide who owns a
-- ticket.
--
-- Both new tables are PLATFORM-level: no tenant_id, and therefore no RLS, the
-- same shape as platform_admins. A support agent's roster entry and the SLA
-- policy are properties of AWA, not of any customer. This is also why they
-- deliberately do NOT get a `tenant_isolation` policy — adding a nullable
-- tenant_id here would make every row invisible to everyone, since the
-- standard policy compares tenant_id to app.current_tenant_id() and NULL never
-- matches (see the plan's §2 note).

-- =========================================================================
-- Agent roster
-- =========================================================================

create table support_agents (
  id                  uuid primary key default gen_random_uuid(),
  platform_admin_id   uuid not null unique references platform_admins(id) on delete cascade,
  active              boolean not null default true,
  -- Empty means "all types" rather than "no types". An agent who handles
  -- nothing would be a roster entry that can never be assigned, which is what
  -- `active = false` is for; empty-means-all keeps the common case zero-config.
  handles_types       support_ticket_type[] not null default '{}',
  -- Empty means "all customers". A non-empty list makes this agent the named
  -- owner for those tenants, which beats load-balancing (§7 step 1).
  covers_tenant_ids   uuid[] not null default '{}',
  -- null = no cap.
  max_open            integer,
  created_at          timestamptz not null default now(),

  constraint support_agent_max_open_positive check (max_open is null or max_open > 0)
);

create index on support_agents (active);

-- Phase A treated every platform admin as a support agent. Seeding the roster
-- from platform_admins preserves exactly that behaviour on deploy, so routing
-- works immediately instead of silently leaving every new ticket unassigned
-- until someone fills the table in.
insert into support_agents (platform_admin_id)
select id from platform_admins
on conflict (platform_admin_id) do nothing;

-- =========================================================================
-- SLA policy
-- =========================================================================

create table support_sla_policies (
  id                      uuid primary key default gen_random_uuid(),
  ticket_type             support_ticket_type not null,
  priority                support_ticket_priority not null,
  first_response_minutes  integer not null,
  -- NULL = no resolution target. A feature request goes to a backlog, not to a
  -- fix; promising a resolution time would make every one of them a permanent
  -- breach, so the absence is recorded rather than faked.
  resolution_minutes      integer,

  unique (ticket_type, priority),
  constraint sla_first_response_positive check (first_response_minutes > 0),
  constraint sla_resolution_positive check (resolution_minutes is null or resolution_minutes > 0)
);

-- Every (type, priority) pair is seeded explicitly rather than leaving priority
-- nullable to mean "any": a nullable column would need every lookup to fall
-- back from an exact match to a wildcard, and a missing row would then be
-- indistinguishable from a deliberate "no target".
insert into support_sla_policies (ticket_type, priority, first_response_minutes, resolution_minutes) values
  -- Bugs are the only type whose targets vary by priority.
  ('bug',             'urgent',  60,    480),      -- 1h  / 8h
  ('bug',             'high',    240,   2880),     -- 4h  / 2d
  ('bug',             'normal',  480,   7200),     -- 8h  / 5d
  ('bug',             'low',     1440,  21600),    -- 24h / 15d
  ('question',        'urgent',  480,   4320),     -- 8h  / 3d
  ('question',        'high',    480,   4320),
  ('question',        'normal',  480,   4320),
  ('question',        'low',     480,   4320),
  ('feature_request', 'urgent',  4320,  null),     -- 3d  / no target
  ('feature_request', 'high',    4320,  null),
  ('feature_request', 'normal',  4320,  null),
  ('feature_request', 'low',     4320,  null),
  ('feedback',        'urgent',  4320,  null),
  ('feedback',        'high',    4320,  null),
  ('feedback',        'normal',  4320,  null),
  ('feedback',        'low',     4320,  null);

-- =========================================================================
-- Clock pause bookkeeping
-- =========================================================================
-- The resolution clock stops while a ticket waits on the customer (§8), and
-- restarting it needs to know when the wait began. Deriving that by scanning
-- support_ticket_events for the last status change would be both slower and
-- fragile — it would silently produce a wrong shift if an event were ever
-- written out of order. One nullable column: set on entering
-- awaiting_customer, read and cleared on leaving.
--
-- first_response_due_at deliberately has no equivalent: first response is
-- unconditionally support's job and its clock never pauses.
alter table support_tickets
  add column awaiting_customer_since timestamptz;
