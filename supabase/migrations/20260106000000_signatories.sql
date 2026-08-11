-- 0006_signatories.sql
-- Authorized-signatory registry (§05): lets a vendor cross-check who at
-- the company can approve a PO at a given value, surfaced on the public
-- QR verification page. max_authorized_value null = unlimited.
create table signatories (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id),
  user_id               uuid not null references users(id),
  title                 text not null,
  max_authorized_value  numeric(14, 2),
  active                boolean not null default true,
  created_at            timestamptz not null default now(),
  unique (tenant_id, user_id)
);

-- app_runtime's DML rights come from 0003's ALTER DEFAULT PRIVILEGES
-- (applies automatically to new tables created by the migrations role).
-- RLS enablement and the policy are not privileges, so they don't
-- inherit from that — this is the first new table since 0001_init.sql's
-- generic RLS loop, so it needs the same treatment applied explicitly.
alter table signatories enable row level security;
create policy tenant_isolation on signatories
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());
