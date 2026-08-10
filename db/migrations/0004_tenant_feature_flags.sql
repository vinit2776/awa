-- 0004_tenant_feature_flags.sql
-- Basic feature flags for the platform console (§14 Sprint 2). Deliberately
-- a jsonb bag on tenants rather than a new table — "basic" means a simple
-- per-tenant toggle set, not a targeting/rollout system. Revisit as a real
-- table if flags ever need audit history or gradual rollout percentages.
alter table tenants
  add column feature_flags jsonb not null default '{}';
