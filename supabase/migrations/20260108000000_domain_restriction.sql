-- 0008_domain_restriction.sql
-- Domain restriction (§09): "only verified company email domains can
-- register." This app has no self-serve signup — every users row is
-- pre-provisioned — so the real enforcement point is JIT sign-in
-- linking (db/tenant.ts), as a second layer of defense against a
-- mis-provisioned row (e.g. a personal email address) beyond "an admin
-- added this." Empty array = unrestricted, matching every tenant that
-- hasn't opted into this.
alter table tenants
  add column allowed_email_domains text[] not null default '{}';
