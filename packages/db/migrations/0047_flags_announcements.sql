-- A-6: feature flags and announcements, run by Mizan staff from the back office.
-- A flag is off unless turned on for everyone or for a store; a store's own setting wins.
-- Announcements reach every store, or the stores on some plans or in some countries, for a window.
CREATE TABLE feature_flags (
  key          TEXT PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_.]{2,60}$'),
  description  TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
  enabled      BOOLEAN NOT NULL DEFAULT false,      -- for every store without its own setting
  updated_by   UUID REFERENCES platform_staff(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE feature_flag_stores (
  flag_key     TEXT NOT NULL REFERENCES feature_flags(key) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  enabled      BOOLEAN NOT NULL,
  updated_by   UUID REFERENCES platform_staff(id) ON DELETE SET NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (flag_key, tenant_id)
);
CREATE INDEX feature_flag_stores_tenant ON feature_flag_stores (tenant_id);
ALTER TABLE feature_flag_stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flag_stores FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON feature_flag_stores
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY platform_all ON feature_flag_stores TO mizan_platform USING (true) WITH CHECK (true);

CREATE TABLE announcements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level       TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info','warning','critical')),
  title_ar    TEXT NOT NULL CHECK (char_length(title_ar) BETWEEN 1 AND 120),
  title_en    TEXT NOT NULL CHECK (char_length(title_en) BETWEEN 1 AND 120),
  body_ar     TEXT NOT NULL DEFAULT '' CHECK (char_length(body_ar) <= 1000),
  body_en     TEXT NOT NULL DEFAULT '' CHECK (char_length(body_en) <= 1000),
  link        TEXT CHECK (link ~ '^https://'),
  plans       TEXT[],                              -- NULL = every plan
  countries   TEXT[],                              -- NULL = every country
  starts_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at     TIMESTAMPTZ NOT NULL,
  created_by  UUID REFERENCES platform_staff(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT announcements_window CHECK (ends_at > starts_at)
);
CREATE INDEX announcements_live ON announcements (ends_at, starts_at);

-- Stores read flags and announcements; only the back office writes them.
REVOKE ALL ON feature_flags, feature_flag_stores, announcements FROM mizan_app, mizan_worker;
GRANT SELECT ON feature_flags, feature_flag_stores, announcements TO mizan_app;
GRANT SELECT ON feature_flags TO mizan_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON feature_flags, feature_flag_stores TO mizan_platform;
GRANT SELECT, INSERT, UPDATE ON announcements TO mizan_platform;
