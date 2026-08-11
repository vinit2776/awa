-- 0009_push_subscriptions.sql
-- Web Push subscriptions (§09 phase 2 PWA v1) — one row per browser/device
-- a user has granted notification permission on, not one per user (the
-- same person can have a laptop and a phone subscribed simultaneously).
create table push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  user_id     uuid not null references users(id),
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now(),
  unique (endpoint)
);

alter table push_subscriptions enable row level security;
create policy tenant_isolation on push_subscriptions
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());
