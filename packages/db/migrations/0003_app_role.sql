-- Application role. The API and worker run every tenant transaction as
-- mizan_app (SET LOCAL ROLE), which has no BYPASSRLS and owns nothing, so the
-- tenant_isolation policies always apply. Login users (Cloud SQL IAM or
-- password) are granted membership in this role by infrastructure, not here.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mizan_app') THEN
    CREATE ROLE mizan_app NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO mizan_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mizan_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mizan_app;

-- Tables and sequences created by later migrations get the same grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mizan_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO mizan_app;

-- The migration ledger belongs to the migrator only.
REVOKE ALL ON schema_migrations FROM mizan_app;
