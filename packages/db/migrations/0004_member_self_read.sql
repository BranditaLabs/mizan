-- A signed-in user may read their own membership rows in every tenant
-- (GET /me lists the stores they belong to before one is chosen).
-- Permissive policies are OR'ed with tenant_isolation, so inside a tenant
-- transaction nothing changes; outside one, only rows where
-- user_id = app.user_id are visible. Read-only: writes still need the tenant.
CREATE POLICY member_self_read ON memberships
  FOR SELECT
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
