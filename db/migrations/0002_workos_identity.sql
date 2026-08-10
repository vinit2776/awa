-- 0002_workos_identity.sql
-- Sprint 1: links our tenant/user records to WorkOS's Organization/User.
-- A tenant's workos_organization_id is set deliberately by a platform admin
-- when onboarding a customer — never auto-created from a sign-in attempt,
-- since organization creation is a business decision, not an auth event.
-- A user's workos_user_id is set on their first successful sign-in (JIT
-- linking, application-side) once a users row already exists for their
-- email within a tenant that has a matching workos_organization_id.

alter table tenants
  add column workos_organization_id text unique;

alter table users
  add column workos_user_id text unique;
