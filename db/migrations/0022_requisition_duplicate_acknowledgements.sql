-- 0022_requisition_duplicate_acknowledgements.sql
-- "Somebody may already have asked for this" — a paper process duplicates
-- requests constantly, and nothing in this app has looked for that until
-- now. The product rule: warn, record, and never block. A hard block on a
-- fuzzy match teaches people to route around the system, which costs more
-- than the duplicates do — so db/duplicateDetection.ts only ever nudges.
-- What turns that nudge into governance is this table: when a requester
-- says "no, this is a different purchase", that answer is recorded and
-- shown to the approver, not silently discarded along with the warning.

create table requisition_duplicate_acknowledgements (
  id                             uuid primary key default gen_random_uuid(),
  tenant_id                      uuid not null references tenants(id),

  -- The requisition being raised, and the earlier, still-live one it was
  -- flagged against. Both point at purchase_requisitions; see
  -- db/duplicateDetection.ts for what "still live" means.
  requisition_id                 uuid not null references purchase_requisitions(id),
  duplicate_of_requisition_id    uuid not null references purchase_requisitions(id),

  acknowledged_by_user_id        uuid not null references users(id),

  -- The whole value of this record is the requester's explanation of why
  -- this isn't a duplicate. Not null on purpose: a nullable reason would
  -- quietly become the common case, and an approver reading "acknowledged,
  -- no reason given" learns nothing a bare row didn't already tell them.
  reason                         text not null,

  created_at                     timestamptz not null default now()
);

-- The approver's view: everything acknowledged against a given requisition.
create index on requisition_duplicate_acknowledgements (tenant_id, requisition_id);
create index on requisition_duplicate_acknowledgements (tenant_id);

alter table requisition_duplicate_acknowledgements enable row level security;
create policy tenant_isolation on requisition_duplicate_acknowledgements
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());

-- Append-only, same discipline as audit_log and approval_decision_log
-- (0003_app_role.sql) and support_ticket_events (0014_support_desk.sql):
-- this is a record of what a person said at a moment in time, and it would
-- be worth nothing to an approver reading it later if it could be edited
-- or deleted after the fact.
revoke update, delete on requisition_duplicate_acknowledgements from app_runtime;
