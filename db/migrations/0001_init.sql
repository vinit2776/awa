-- 0001_init.sql
-- Initial schema: phase 0 (platform foundation) + phase 1 (core procurement MVP)
-- Section references (§NN) point back to the scope document.
-- Postgres 15+. Isolation model: row-level security on every tenant-scoped table (§10).

-- =========================================================================
-- Extensions
-- =========================================================================
create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists pg_trgm;    -- catalog fuzzy search (§07)

-- =========================================================================
-- Helper schema & functions
-- =========================================================================
create schema if not exists app;

-- Reads the tenant id the application sets for the current transaction.
-- The app must run `set local app.tenant_id = '<uuid>'` as the first
-- statement of every request-scoped transaction.
create or replace function app.current_tenant_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

create or replace function app.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================================================================
-- Foundation (§10) — tenants, platform admins, users, roles, org structure
-- =========================================================================

create type tenant_status as enum ('active', 'suspended', 'offboarded');

create table tenants (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  slug         text not null unique,          -- subdomain / routing key
  status       tenant_status not null default 'active',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Platform-level operators (§02). Deliberately outside the tenant model —
-- no tenant_id column, so the RLS loop below skips this table entirely.
create type platform_admin_role as enum ('super_admin', 'support');

create table platform_admins (
  id           uuid primary key default gen_random_uuid(),
  email        text not null unique,
  full_name    text not null,
  role         platform_admin_role not null,
  created_at   timestamptz not null default now()
);

create type user_status as enum ('invited', 'active', 'disabled');

create table users (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  email        text not null,
  full_name    text not null,
  status       user_status not null default 'invited',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, email)
);

-- Tenant-configurable role definitions (§02) — a template, not hardcoded logic.
create table roles (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  key           text not null,          -- stable key, e.g. 'department_head'
  display_name  text not null,          -- tenant can rename this freely
  is_system     boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (tenant_id, key)
);

create table cost_centers (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  name         text not null,
  code         text not null,
  currency     text not null default 'INR',
  created_at   timestamptz not null default now(),
  unique (tenant_id, code)
);

create table departments (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id),
  name                  text not null,
  parent_department_id  uuid references departments(id),
  default_cost_center_id uuid references cost_centers(id),
  created_at            timestamptz not null default now()
);

-- Role assignment, scoped (§04). Doubles as the source the approval engine
-- resolves against: "who is the IT Head" / "who is the Sales dept head".
create type role_scope_type as enum ('global', 'department', 'cost_center');

create table user_roles (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  user_id         uuid not null references users(id),
  role_id         uuid not null references roles(id),
  scope_type      role_scope_type not null default 'global',
  scope_id        uuid,                 -- department_id or cost_center_id; null when global
  effective_from  timestamptz not null default now(),
  effective_to    timestamptz,
  created_at      timestamptz not null default now()
);
create index on user_roles (tenant_id, role_id, scope_type, scope_id);

-- Append-only audit trail (§01, §10). No update/delete privileges — see
-- the GRANT note at the bottom of this file.
create table audit_log (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  actor_user_id uuid references users(id),   -- null for system-initiated events
  action        text not null,               -- e.g. 'pr.submitted', 'catalog.merged'
  entity_type   text not null,
  entity_id     uuid not null,
  metadata      jsonb not null default '{}',
  occurred_at   timestamptz not null default now()
);
create index on audit_log (tenant_id, entity_type, entity_id);
create index on audit_log (tenant_id, occurred_at);

-- =========================================================================
-- Catalog & vendors (§07, §05)
-- =========================================================================

create table catalog_categories (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id),
  name                  text not null,
  parent_category_id    uuid references catalog_categories(id),
  asset_eligible        boolean not null default false,  -- feeds phase-3 asset auto-creation
  asset_value_threshold numeric(14,2),
  created_at            timestamptz not null default now()
);

create type catalog_item_status as enum ('unverified', 'verified', 'merged');

create table catalog_items (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id),
  name               text not null,
  category_id        uuid references catalog_categories(id),
  uom                text not null default 'each',
  status             catalog_item_status not null default 'unverified',
  canonical_item_id  uuid references catalog_items(id),  -- set on merge; never delete (§07)
  created_by         uuid references users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
-- Trigram index powers the "did you mean…" typeahead match at creation time.
create index catalog_items_name_trgm on catalog_items using gin (name gin_trgm_ops);

create type vendor_status as enum ('pending', 'active', 'blacklisted');

create table vendors (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  name         text not null,
  tax_id       text,
  status       vendor_status not null default 'pending',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create type bank_account_status as enum ('pending_verification', 'active', 'superseded');

-- Bank details are versioned, never overwritten in place (§05) — a change
-- inserts a new row and marks the prior one superseded, after out-of-band
-- verification. The active row is what payment release reads from.
create table vendor_bank_accounts (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id),
  vendor_id            uuid not null references vendors(id),
  account_holder_name  text not null,
  account_number_enc   text not null,   -- encrypted at the application layer
  bank_name            text not null,
  ifsc_or_swift        text not null,
  status               bank_account_status not null default 'pending_verification',
  verified_by          uuid references users(id),
  verified_at          timestamptz,
  effective_from       timestamptz not null default now(),
  created_at           timestamptz not null default now()
);

create table vendor_users (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  vendor_id    uuid not null references vendors(id),
  email        text not null,
  full_name    text not null,
  status       user_status not null default 'invited',
  created_at   timestamptz not null default now(),
  unique (tenant_id, vendor_id, email)
);

-- =========================================================================
-- Requisition & approval engine (§04)
-- =========================================================================

create type requisition_status as enum (
  'draft', 'submitted', 'pending_approval',
  'approved', 'rejected_revisable', 'rejected_closed',
  'converted_to_po', 'cancelled'
);

create table purchase_requisitions (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenants(id),
  requestor_id           uuid not null references users(id),
  department_id          uuid references departments(id),
  cost_center_id         uuid references cost_centers(id),
  status                 requisition_status not null default 'draft',
  total_estimated_value  numeric(14,2) not null default 0,
  currency               text not null default 'INR',
  justification          text,
  created_at             timestamptz not null default now(),
  submitted_at           timestamptz,
  updated_at             timestamptz not null default now()
);
create index on purchase_requisitions (tenant_id, status);

create type fulfillment_type as enum ('goods', 'service');

create table purchase_requisition_lines (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id),
  requisition_id        uuid not null references purchase_requisitions(id),
  catalog_item_id       uuid references catalog_items(id),
  free_text_description text,           -- used when catalog_item_id is null
  category_id           uuid references catalog_categories(id),
  fulfillment_type      fulfillment_type not null,
  quantity              numeric(14,3) not null default 1,
  uom                    text not null default 'each',
  estimated_unit_price   numeric(14,2) not null default 0,
  line_total             numeric(14,2) not null default 0
);

create type combination_mode as enum ('additive', 'exclusive');

-- The configurable matrix (§04): category × value × department → roles.
create table approval_rules (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  name              text not null,
  category_id       uuid references catalog_categories(id),   -- null = any category
  department_id     uuid references departments(id),          -- null = global
  cost_center_id    uuid references cost_centers(id),          -- null = any
  min_value         numeric(14,2) not null default 0,
  max_value         numeric(14,2),                             -- null = no ceiling
  currency          text not null default 'INR',
  combination_mode  combination_mode not null default 'additive',
  priority          integer not null default 0,
  active            boolean not null default true,
  effective_from    timestamptz not null default now(),
  effective_to      timestamptz,
  created_by        uuid references users(id),
  created_at        timestamptz not null default now(),
  updated_by        uuid references users(id),
  updated_at        timestamptz not null default now()
);
create index on approval_rules (tenant_id, active, category_id, department_id);

create table approval_rule_requirements (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references tenants(id),
  rule_id                  uuid not null references approval_rules(id),
  approver_role_id         uuid not null references roles(id),
  group_no                 integer not null default 1,   -- same group = parallel
  group_sequence           integer not null default 1,   -- higher = gated behind lower
  min_approvals_in_group   integer not null default 1
);

create type approval_source as enum ('rule', 'ad_hoc');
create type approval_status as enum ('pending', 'approved', 'rejected', 'delegated');

-- The frozen, per-requisition instance (§04) — this is the "combined
-- approver set" that the rule engine assembles and any pending approver
-- can extend.
create table requisition_approval_requirements (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenants(id),
  requisition_id         uuid not null references purchase_requisitions(id),
  source                 approval_source not null,
  source_rule_id         uuid references approval_rules(id),
  assigned_user_id       uuid not null references users(id),
  group_no               integer not null default 1,
  group_sequence         integer not null default 1,
  added_by_user_id       uuid references users(id),   -- required when source = ad_hoc
  reason                 text,                         -- required when source = ad_hoc
  status                 approval_status not null default 'pending',
  decided_at             timestamptz,
  decision_comment       text,
  delegate_of_user_id    uuid references users(id),
  created_at             timestamptz not null default now(),
  check (source <> 'ad_hoc' or (reason is not null and added_by_user_id is not null))
);
create index on requisition_approval_requirements (tenant_id, requisition_id, status);

create type approval_action as enum
  ('approved', 'rejected', 'delegated', 'approver_added', 'commented');

-- Append-only decision trail — kept separate from the mutable status field
-- above so history survives even if a requirement row is later reinterpreted.
create table approval_decision_log (
  id                                     uuid primary key default gen_random_uuid(),
  tenant_id                              uuid not null references tenants(id),
  requisition_approval_requirement_id    uuid not null references requisition_approval_requirements(id),
  actor_user_id                          uuid not null references users(id),
  action                                 approval_action not null,
  comment                                text,
  occurred_at                            timestamptz not null default now(),
  metadata                               jsonb not null default '{}'
);

-- =========================================================================
-- Sourcing & purchase orders (§05)
-- =========================================================================

create type rfq_status as enum ('open', 'closed', 'cancelled');

create table rfqs (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  requisition_id   uuid not null references purchase_requisitions(id),
  status           rfq_status not null default 'open',
  created_at       timestamptz not null default now()
);

create type invitation_status as enum ('invited', 'quoted', 'declined');

create table rfq_vendor_invitations (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  rfq_id       uuid not null references rfqs(id),
  vendor_id    uuid not null references vendors(id),
  status       invitation_status not null default 'invited',
  created_at   timestamptz not null default now(),
  unique (rfq_id, vendor_id)
);

create type quotation_status as enum ('submitted', 'selected', 'rejected');

create table vendor_quotations (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  rfq_id         uuid not null references rfqs(id),
  vendor_id      uuid not null references vendors(id),
  total_amount   numeric(14,2) not null,
  currency       text not null default 'INR',
  valid_until    date,
  status         quotation_status not null default 'submitted',
  submitted_at   timestamptz not null default now()
);

create type po_status as enum
  ('draft', 'issued', 'partially_fulfilled', 'fulfilled', 'cancelled');

create table purchase_orders (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  requisition_id   uuid not null references purchase_requisitions(id),
  vendor_id        uuid not null references vendors(id),
  po_number        text not null,
  status           po_status not null default 'draft',
  total_amount     numeric(14,2) not null default 0,
  currency         text not null default 'INR',
  document_hash    text,          -- tamper-evident hash of the issued PO (§05)
  qr_token         text,          -- opaque, non-guessable vendor verification token
  signed_by        uuid references users(id),
  signed_at        timestamptz,
  created_at       timestamptz not null default now(),
  unique (tenant_id, po_number),
  unique (qr_token)
);

create table purchase_order_lines (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id),
  po_id                 uuid not null references purchase_orders(id),
  requisition_line_id   uuid references purchase_requisition_lines(id),
  fulfillment_type      fulfillment_type not null,   -- the goods/services fork (§03)
  item_id               uuid references catalog_items(id),
  service_description   text,
  quantity              numeric(14,3) not null default 1,
  uom                   text not null default 'each',
  unit_price            numeric(14,2) not null default 0,
  line_total            numeric(14,2) not null default 0,
  status                po_status not null default 'draft'
);
create index on purchase_order_lines (tenant_id, po_id);

-- =========================================================================
-- Fulfillment: goods receipt & service acceptance (§03)
-- =========================================================================

create table goods_receipt_notes (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id),
  po_id              uuid not null references purchase_orders(id),
  delivery_note_ref  text,
  received_by        uuid references users(id),
  received_at        timestamptz not null default now(),
  status             text not null default 'draft'
);

create type grn_condition as enum ('good', 'damaged', 'short');

create table goods_receipt_lines (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id),
  grn_id              uuid not null references goods_receipt_notes(id),
  po_line_id          uuid not null references purchase_order_lines(id),
  quantity_delivered  numeric(14,3) not null,
  quantity_accepted   numeric(14,3) not null default 0,
  quantity_rejected   numeric(14,3) not null default 0,
  condition           grn_condition not null default 'good',
  serial_numbers      jsonb not null default '[]',   -- feeds phase-3 asset creation (§08)
  rejection_reason    text,
  verified_by         uuid not null references users(id),  -- must differ from the requestor
  verified_at         timestamptz not null default now()
);

create table vendor_returns (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id),
  grn_line_id          uuid not null references goods_receipt_lines(id),
  quantity             numeric(14,3) not null,
  reason               text not null,
  return_shipment_ref  text,
  credit_note_ref      text,
  status               text not null default 'initiated'
);

create type service_acceptance_type as enum ('milestone', 'full_completion');

create table service_acceptances (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  po_id             uuid not null references purchase_orders(id),
  acceptance_type   service_acceptance_type not null default 'full_completion',
  status            text not null default 'open'
);

create table service_milestones (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  po_id             uuid not null references purchase_orders(id),
  milestone_no      integer not null,
  description       text not null,
  percent_of_value  numeric(5,2),
  fixed_value       numeric(14,2),
  due_date          date
);

create type service_line_status as enum ('accepted', 'rejected', 'partial');

create table service_acceptance_lines (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references tenants(id),
  service_acceptance_id     uuid not null references service_acceptances(id),
  po_line_id                uuid not null references purchase_order_lines(id),
  milestone_id              uuid references service_milestones(id),
  accepted_value             numeric(14,2) not null default 0,
  deliverable_reference_url  text,
  status                     service_line_status not null default 'accepted',
  rejection_reason           text,
  accepted_by                uuid not null references users(id),
  accepted_at                timestamptz not null default now()
);

-- =========================================================================
-- Invoicing & payment (§03, §06)
-- =========================================================================

create type invoice_status as enum
  ('submitted', 'matched', 'exception', 'approved_for_payment', 'paid', 'disputed');

create table invoices (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  vendor_id       uuid not null references vendors(id),
  po_id           uuid references purchase_orders(id),
  invoice_number  text not null,
  invoice_date    date not null,
  total_amount    numeric(14,2) not null,
  currency        text not null default 'INR',
  document_url    text,
  document_hash   text,           -- perceptual/exact hash, phase-3 fingerprinting (§06)
  status          invoice_status not null default 'submitted',
  created_at      timestamptz not null default now(),
  -- phase-1 duplicate baseline: exact match on vendor + invoice number (§06)
  unique (tenant_id, vendor_id, invoice_number)
);

create table invoice_lines (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  invoice_id   uuid not null references invoices(id),
  po_line_id   uuid references purchase_order_lines(id),
  quantity     numeric(14,3) not null default 1,
  unit_price   numeric(14,2) not null default 0,
  line_total   numeric(14,2) not null default 0
);

create type match_status as enum ('matched', 'exception');
create type fulfillment_ref_type as enum ('goods_receipt_line', 'service_acceptance_line');

-- Unifies the goods/services fork for 3-way matching (§03): a line is
-- either "received" or "accepted" before it can match — this table doesn't
-- need to know which branch produced that confirmation.
create table invoice_line_matches (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references tenants(id),
  invoice_line_id          uuid not null references invoice_lines(id),
  po_line_id               uuid not null references purchase_order_lines(id),
  matched_fulfillment_type fulfillment_ref_type not null,
  matched_fulfillment_id   uuid not null,   -- polymorphic; enforced in application code
  matched_quantity         numeric(14,3),
  matched_value            numeric(14,2),
  variance                 numeric(14,2) not null default 0,
  status                   match_status not null default 'matched'
);

create type payment_status as enum ('queued', 'released', 'failed');

create table payment_instructions (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  invoice_id    uuid not null references invoices(id),
  amount        numeric(14,2) not null,
  currency      text not null default 'INR',
  status        payment_status not null default 'queued',
  released_by   uuid references users(id),   -- the deliberate human step (§05)
  released_at   timestamptz,
  created_at    timestamptz not null default now()
);

-- =========================================================================
-- Segregation-of-duties example trigger (§02, §03)
-- One worked example; the same pattern applies wherever a role must not
-- also hold another role on the same transaction (e.g. invoice approver
-- ≠ goods receiver) — add as those flows are built.
-- =========================================================================

create or replace function app.enforce_receiver_not_requestor() returns trigger
language plpgsql as $$
declare
  v_requestor uuid;
begin
  select pr.requestor_id into v_requestor
  from purchase_order_lines pol
  join purchase_orders po on po.id = pol.po_id
  join purchase_requisitions pr on pr.id = po.requisition_id
  where pol.id = new.po_line_id;

  if v_requestor = new.verified_by then
    raise exception
      'segregation of duties: the requestor cannot verify goods receipt on their own requisition';
  end if;

  return new;
end;
$$;

create trigger enforce_receiver_not_requestor
  before insert or update on goods_receipt_lines
  for each row execute function app.enforce_receiver_not_requestor();

-- =========================================================================
-- Row-level security (§10)
-- Applied generically to every table carrying a tenant_id column, so new
-- tables added in later migrations only need the column — RLS follows
-- automatically the next time this block (or its migration-tool equivalent)
-- runs against them.
-- =========================================================================

do $$
declare
  t record;
begin
  for t in
    select table_name
    from information_schema.columns
    where table_schema = 'public'
      and column_name = 'tenant_id'
  loop
    execute format('alter table %I enable row level security', t.table_name);
    execute format(
      'create policy tenant_isolation on %I
         using (tenant_id = app.current_tenant_id())
         with check (tenant_id = app.current_tenant_id())',
      t.table_name
    );
  end loop;
end $$;

-- =========================================================================
-- updated_at maintenance — applied to every table with an updated_at column
-- =========================================================================

do $$
declare
  t record;
begin
  for t in
    select table_name
    from information_schema.columns
    where table_schema = 'public'
      and column_name = 'updated_at'
  loop
    execute format(
      'create trigger set_updated_at before update on %I
         for each row execute function app.set_updated_at()',
      t.table_name
    );
  end loop;
end $$;

-- =========================================================================
-- Audit log immutability — application role can insert and select only.
-- Replace `app_role` with whatever role your connection pool authenticates
-- as; superuser/migration roles are unaffected.
-- =========================================================================

-- revoke update, delete on audit_log from app_role;
-- revoke update, delete on approval_decision_log from app_role;
