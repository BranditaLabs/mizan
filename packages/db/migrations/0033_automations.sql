-- E11-1 automation runtime. An automation is a trigger event, conditions and steps (0001); a
-- run is recorded once per event (UNIQUE (automation_id, event_id), 0001). Added here: who made
-- it and why it stopped, the run's version, chain depth and steps, and team notifications.

ALTER TABLE automations
  ADD COLUMN description  TEXT CHECK (length(description) <= 300),
  ADD COLUMN paused_reason TEXT CHECK (paused_reason IN ('errors')),
  ADD COLUMN created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN runs         INT NOT NULL DEFAULT 0,
  ADD COLUMN failures     INT NOT NULL DEFAULT 0,
  ADD COLUMN last_run_at  TIMESTAMPTZ;
CREATE INDEX automations_trigger ON automations (tenant_id, trigger_event) WHERE enabled;

ALTER TABLE automation_runs
  ADD COLUMN version     INT NOT NULL DEFAULT 1,
  ADD COLUMN event_type  TEXT NOT NULL DEFAULT '',
  ADD COLUMN entity_id   UUID,
  ADD COLUMN depth       SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN reason      TEXT;
CREATE INDEX automation_runs_recent ON automation_runs (tenant_id, automation_id, created_at DESC);

-- What the team should see (notify.team, later low stock and other alerts): ids, roles and a
-- short text built from ids and numbers (never personal data). Read marks are per person.
CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  roles       TEXT[] NOT NULL CHECK (cardinality(roles) > 0),
  text        TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 400),
  entity_type TEXT,
  entity_id   UUID,
  source      TEXT NOT NULL,          -- 'automation:<id>' …
  dedupe_key  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_recent ON notifications (tenant_id, created_at DESC);
CREATE UNIQUE INDEX notifications_dedupe ON notifications (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE notification_reads (
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, user_id)
);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['notifications','notification_reads'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;
