-- A-3: support access. A Mizan staff member reaches a store's own data only through a time-limited
-- grant: a reason, an expiry (at most 8 hours), read-only unless a super admin opened it for writing.
-- The store sees every grant (banner while open, its audit log always) and can end it early.
CREATE TABLE support_access (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  staff_id    UUID REFERENCES platform_staff(id) ON DELETE SET NULL,
  mode        TEXT NOT NULL DEFAULT 'read' CHECK (mode IN ('read','write')),
  reason      TEXT NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500),
  expires_at  TIMESTAMPTZ NOT NULL,
  ended_at    TIMESTAMPTZ,
  ended_by    TEXT CHECK (ended_by IN ('staff','store')),
  ended_by_user UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT support_access_window CHECK (expires_at > created_at AND expires_at <= created_at + interval '8 hours'),
  CONSTRAINT support_access_end_whole CHECK ((ended_at IS NULL) = (ended_by IS NULL))
);
CREATE INDEX support_access_open ON support_access (tenant_id, expires_at) WHERE ended_at IS NULL;
CREATE INDEX support_access_staff ON support_access (staff_id, expires_at) WHERE ended_at IS NULL;

ALTER TABLE support_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_access FORCE ROW LEVEL SECURITY;
-- The store reads its grants and may end one; it never opens or changes them otherwise.
CREATE POLICY tenant_isolation ON support_access
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY platform_all ON support_access TO mizan_platform USING (true) WITH CHECK (true);

REVOKE ALL ON support_access FROM mizan_app, mizan_worker;
GRANT SELECT ON support_access TO mizan_app;
GRANT UPDATE (ended_at, ended_by, ended_by_user) ON support_access TO mizan_app;
GRANT SELECT, INSERT ON support_access TO mizan_platform;
GRANT UPDATE (ended_at, ended_by) ON support_access TO mizan_platform;
