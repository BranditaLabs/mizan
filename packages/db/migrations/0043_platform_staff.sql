-- A-1: Mizan staff (the back office, E17). Staff are Mizan users with a platform role; they reach
-- /v1/platform/* only, with two-step sign-in, and every call is recorded in platform_audit
-- (append-only). The staff tables are invisible to the app role; the back office runs as
-- mizan_platform, which reads across stores only what it needs (stores, people, connections,
-- jobs, events, usage) — never orders, customers, secrets or money lines. A support person who
-- needs a store's data gets time-limited access through that store's own context (A-3).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mizan_platform') THEN
    CREATE ROLE mizan_platform NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO mizan_platform;

CREATE TABLE platform_staff (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('super_admin','support','finance','engineer')),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  added_by    UUID REFERENCES platform_staff(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE platform_audit (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  staff_id    UUID REFERENCES platform_staff(id) ON DELETE SET NULL,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,                       -- "GET /v1/platform/staff", "staff.added", "denied" …
  outcome     TEXT NOT NULL CHECK (outcome IN ('ok','denied','failed')),
  status      SMALLINT,
  target_type TEXT,
  target_id   TEXT,
  store_id    UUID,                                -- the store a staff action was about (not tenant data: no RLS)
  ip          TEXT,
  data        JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX platform_audit_recent ON platform_audit (created_at DESC);
CREATE INDEX platform_audit_staff ON platform_audit (staff_id, created_at DESC);

-- The app role never sees staff or their trail; the platform role may add to the trail, never change it.
REVOKE ALL ON platform_staff, platform_audit FROM mizan_app, mizan_worker;
GRANT SELECT, INSERT, UPDATE ON platform_staff TO mizan_platform;
GRANT SELECT, INSERT ON platform_audit TO mizan_platform;

-- What the back office reads across stores. RLS tables get a read-only policy for this role.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenants','users','memberships','connections','mz_outbox','domain_events','usage_months'] LOOP
    EXECUTE format('GRANT SELECT ON %I TO mizan_platform', t);
    IF (SELECT relrowsecurity FROM pg_class WHERE oid = format('public.%I', t)::regclass) THEN
      EXECUTE format('CREATE POLICY platform_read ON %I FOR SELECT TO mizan_platform USING (true)', t);
    END IF;
  END LOOP;
END $$;
