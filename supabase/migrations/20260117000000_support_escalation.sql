-- 0017_support_escalation.sql
-- Support desk Phase C (docs/support-desk-plan.md §4.7, §8): the escalation
-- matrix. Phase B made breach visible in the queue; nothing yet tells a person
-- about it. This is what the sweep reads to decide who to notify.
--
-- Platform-level, like support_agents and support_sla_policies (0016): no
-- tenant_id, no RLS. Escalation policy is AWA's, not a customer's.

create type support_escalation_trigger as enum (
  'first_response_breach',
  'resolution_breach',
  'reopened_twice',
  'customer_escalated'
);

create table support_escalation_matrix (
  id                        uuid primary key default gen_random_uuid(),
  level                     integer not null,
  trigger                   support_escalation_trigger not null,
  -- Grace past the trigger condition before this level fires. 0 = immediately.
  after_minutes             integer not null default 0,
  -- Optional named contact, and/or every admin holding a role. Both null means
  -- "the assigned agent only", which is L1's shape.
  notify_platform_admin_id  uuid references platform_admins(id) on delete set null,
  notify_role               platform_admin_role,
  created_at                timestamptz not null default now(),

  unique (level, trigger),
  constraint escalation_level_range check (level between 1 and 2),
  constraint escalation_grace_non_negative check (after_minutes >= 0)
);

create index on support_escalation_matrix (trigger, level);

-- L0 is the assigned agent and is not a row — it's the default owner.
--
-- One deliberate deviation from the plan's prose: L2's resolution trigger was
-- described as "2× the resolution target". That isn't expressible in this
-- table, because the target varies per ticket by type and priority, so a fixed
-- after_minutes can't encode it. A flat 24h grace past the breach is used
-- instead: simpler, and it escalates an urgent bug (8h target) far sooner in
-- relative terms than a low one (15d), which is the behaviour that was wanted.
insert into support_escalation_matrix (level, trigger, after_minutes, notify_role) values
  -- L1: the agent who owns it hears first, with no grace.
  (1, 'first_response_breach', 0,    null),
  (1, 'resolution_breach',     0,    null),
  -- L2: still unresolved a day past the deadline, or the customer has escalated,
  -- or it has bounced back twice — super admins get told.
  (2, 'resolution_breach',     1440, 'super_admin'),
  (2, 'customer_escalated',    0,    'super_admin'),
  (2, 'reopened_twice',        0,    'super_admin');
