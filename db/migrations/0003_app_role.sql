-- 0003_app_role.sql
-- The connection string used for migrations (postgres.<ref>, the table
-- owner) bypasses RLS entirely — Postgres does not apply row-level
-- security to table owners or superusers. §10's isolation model only
-- means anything if the application itself connects as a role that is
-- actually subject to the policies. This creates that role.
--
-- app_runtime gets row-level DML rights, not ownership — RLS policies from
-- 0001_init.sql apply to it in full. The owner role stays for migrations.

-- No password here deliberately — nothing secret belongs in a committed,
-- version-controlled migration file. The password is set once, out of
-- band, via a direct ALTER ROLE right after this migration is applied.
create role app_runtime with login;

grant usage on schema public to app_runtime;
grant select, insert, update, delete on all tables in schema public to app_runtime;
grant usage, select on all sequences in schema public to app_runtime;

alter default privileges in schema public
  grant select, insert, update, delete on tables to app_runtime;
alter default privileges in schema public
  grant usage, select on sequences to app_runtime;

-- Append-only enforcement (the TODO left at the bottom of 0001_init.sql).
revoke update, delete on audit_log from app_runtime;
revoke update, delete on approval_decision_log from app_runtime;
