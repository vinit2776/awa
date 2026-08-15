-- Escalation engine (lifecycle audit, §08): the biggest structural gap
-- found in the audit — not disconnected, absent. A pending approval
-- older than the tenant's SLA now gets escalated by a scheduled job
-- (src/app/api/cron/escalate-approvals) rather than sitting silently
-- forever with only a passive "N days pending" label.
--
-- escalation_sla_hours is per-tenant (0 disables it for that tenant),
-- matching the existing "tenant-owned config, not a hardcoded constant"
-- shape the approval matrix already uses.
alter table tenants
  add column escalation_sla_hours integer not null default 48;

-- actionable_at is deliberately separate from created_at: every
-- requirement row for every group is inserted up front at submission
-- time, but a group-2+ row isn't actually waiting on anyone until group
-- 1 clears. The SLA clock has to start there, not at insert time.
alter table requisition_approval_requirements
  add column actionable_at timestamptz,
  add column escalated_at timestamptz;

-- Backfill: for every requisition with a currently-pending approval,
-- stamp actionable_at on whichever group is actually the current one
-- (the same "lowest group_no among pending rows" rule the app already
-- uses) — otherwise every existing pending approval reads as never-yet-
-- actionable and the SLA check would silently skip all of them until a
-- fresh group transition happens to set it naturally.
with current_groups as (
  select requisition_id, min(group_no) as min_group
  from requisition_approval_requirements
  where status = 'pending'
  group by requisition_id
)
update requisition_approval_requirements r
set actionable_at = r.created_at
from current_groups cg
where r.requisition_id = cg.requisition_id
  and r.group_no = cg.min_group
  and r.status = 'pending'
  and r.actionable_at is null;
