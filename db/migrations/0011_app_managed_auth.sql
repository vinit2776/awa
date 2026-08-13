-- 0011_app_managed_auth.sql
-- Temporary swap to app-managed email+password auth (db/userAuth.ts),
-- replacing WorkOS for testing — see AGENTS.md. workos_user_id stays on
-- users untouched so WorkOS can be reconnected later without another
-- migration; this only adds the column the new path actually checks.
alter table users
  add column password_hash text;

alter table platform_admins
  add column password_hash text;
