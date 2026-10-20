-- Domain event dispatch (E1-8, ADR-0002). Events are written to domain_events
-- in the same transaction as the state change; a dispatcher delivers them to
-- consumers with leases, backoff and dead letters, like the engine outbox.

ALTER TABLE domain_events
  ADD COLUMN attempts        INT NOT NULL DEFAULT 0,
  ADD COLUMN next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN locked_until    TIMESTAMPTZ,
  ADD COLUMN last_error      TEXT,
  ADD COLUMN dead_at         TIMESTAMPTZ;

DROP INDEX IF EXISTS domain_events_undispatched;
CREATE INDEX domain_events_due ON domain_events (next_attempt_at, occurred_at)
  WHERE dispatched_at IS NULL AND dead_at IS NULL;

-- One row per (consumer, event), written in the same transaction as the
-- consumer's effect: a consumer sees each event exactly once, even when the
-- dispatcher crashes between a consumer's commit and marking the event done.
CREATE TABLE event_deliveries (
  consumer        TEXT NOT NULL,
  event_id        UUID NOT NULL REFERENCES domain_events(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  delivered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);
ALTER TABLE event_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON event_deliveries
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- The dispatcher claims events across tenants as mizan_worker. That role can
-- read and update domain_events only; consumers run under withTenant as usual.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mizan_worker') THEN
    CREATE ROLE mizan_worker NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO mizan_worker;
GRANT SELECT, UPDATE ON domain_events TO mizan_worker;
CREATE POLICY dispatcher_all ON domain_events TO mizan_worker USING (true) WITH CHECK (true);
