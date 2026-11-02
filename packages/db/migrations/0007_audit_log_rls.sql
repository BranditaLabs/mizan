-- Audit log hardening (E1-9). 0001 created audit_log without RLS; fix that:
-- - reads and writes are scoped to the tenant like every other tenant table;
-- - platform-level entries (tenant_id NULL, e.g. sign-in events) can be
--   written without a tenant but are not readable through the app role;
-- - the app role can only append: no UPDATE or DELETE, so a compromised API
--   cannot rewrite history.

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON audit_log
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY platform_append ON audit_log
  FOR INSERT
  WITH CHECK (tenant_id IS NULL);

REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM mizan_app;

CREATE INDEX audit_log_tenant_recent ON audit_log (tenant_id, id DESC);
CREATE INDEX audit_log_tenant_action ON audit_log (tenant_id, action, id DESC);
