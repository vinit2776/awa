-- 0005_cost_center_budget.sql
-- Minimal budget field for the S4 "budget display" soft warning — a single
-- annual figure per cost center, not a fiscal-year-windowed budgeting
-- system. Nullable: a tenant that hasn't set one just sees no budget info,
-- never a false warning.
alter table cost_centers
  add column annual_budget numeric(14, 2);
