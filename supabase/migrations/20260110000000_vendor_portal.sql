-- Sprint 16: vendor portal (§05) — a vendor logging in (magic link, not
-- WorkOS — vendor_users has no workos_user_id/password, they're an
-- external company, not a tenant-org member) to confirm a PO themselves,
-- rather than trusting the emailed PDF alone.
--
-- vendor_confirmed_at / vendor_confirmed_by turn "vendor logged in and
-- confirmed" into a queryable fact on the PO itself, not just an
-- audit_log entry — the tenant-side PO view can show it directly.
alter table purchase_orders
  add column vendor_confirmed_at timestamptz,
  add column vendor_confirmed_by uuid references vendor_users(id);
