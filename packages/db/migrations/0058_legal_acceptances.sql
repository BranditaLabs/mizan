-- L1-3: a store's acceptance of the terms of service and the data processing agreement, one row
-- per document and version (the versions live in @mizan/shared LEGAL_VERSIONS). The privacy policy
-- is a notice, not accepted, so it has no row. Acceptances are evidence: the app role may add one
-- and read its store's, never change or remove one.
CREATE TABLE legal_acceptances (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document     TEXT NOT NULL CHECK (document IN ('terms','dpa')),
  version      TEXT NOT NULL CHECK (version ~ '^[0-9]+\.[0-9]+$'),
  accepted_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  language     TEXT CHECK (language IN ('ar','en')),
  accepted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, document, version)
);

ALTER TABLE legal_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_acceptances FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_acceptances
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

REVOKE UPDATE, DELETE, TRUNCATE ON legal_acceptances FROM mizan_app;
