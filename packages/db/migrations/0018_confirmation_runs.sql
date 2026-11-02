-- E6-7 automated confirmation (M2). One run per order walks the store's cascade
-- (WhatsApp → SMS link → automated call → agent); every send and every wait is a
-- scheduled step (the module's outbox, CLAUDE.md rule 3); any channel answers through
-- the same service, and the customer can always answer on the public link page.

CREATE TABLE confirmation_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id          UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','confirmed','cancelled','needs_agent','stopped')),
  -- The cascade as it was when the run started: [{ "channel": "whatsapp", "waitMinutes": 120 }, …]
  plan              JSONB NOT NULL DEFAULT '[]',
  step              SMALLINT NOT NULL DEFAULT 0,
  outcome           TEXT CHECK (outcome IN ('confirmed','changed','cancelled','wrong_number','no_reply')),
  answered_channel  TEXT,
  reason            TEXT,
  link_expires_at   TIMESTAMPTZ NOT NULL,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at       TIMESTAMPTZ
);
-- At most one live run per order (a store sync replay never starts a second one).
CREATE UNIQUE INDEX confirmation_runs_live ON confirmation_runs (order_id) WHERE status IN ('running','needs_agent');
CREATE INDEX confirmation_runs_order ON confirmation_runs (tenant_id, order_id, started_at DESC);

CREATE TABLE confirmation_steps (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_id           UUID NOT NULL REFERENCES confirmation_runs(id) ON DELETE CASCADE,
  idx              SMALLINT NOT NULL,
  channel          TEXT NOT NULL CHECK (channel IN ('whatsapp','sms','voice','agent')),
  kind             TEXT NOT NULL CHECK (kind IN ('send','timeout')),
  run_at           TIMESTAMPTZ NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','skipped','cancelled','dead')),
  attempts         SMALLINT NOT NULL DEFAULT 0,
  locked_until     TIMESTAMPTZ,
  idempotency_key  TEXT NOT NULL,
  provider_ref     TEXT,
  last_error       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX confirmation_steps_due ON confirmation_steps (run_at) WHERE status IN ('pending','running');

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['confirmation_runs','confirmation_steps'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

-- The worker only finds which stores have due steps (then works inside each store's
-- context), and the public link page finds which store a run belongs to. Ids and times only.
GRANT SELECT (tenant_id, run_at, status, locked_until) ON confirmation_steps TO mizan_worker;
CREATE POLICY worker_find_due ON confirmation_steps FOR SELECT TO mizan_worker USING (true);
GRANT SELECT (id, tenant_id) ON confirmation_runs TO mizan_worker;
CREATE POLICY worker_find_run ON confirmation_runs FOR SELECT TO mizan_worker USING (true);

-- Attempts log: the public link, automated voice and (V2) the AI voice agent are channels too.
ALTER TABLE confirmations DROP CONSTRAINT IF EXISTS confirmations_channel_check;
ALTER TABLE confirmations ADD CONSTRAINT confirmations_channel_check
  CHECK (channel IN ('auto','whatsapp','call','sms','voice_bot','link','voice_ivr','voice_ai','agent'));
ALTER TABLE confirmations DROP CONSTRAINT IF EXISTS confirmations_outcome_check;
ALTER TABLE confirmations ADD CONSTRAINT confirmations_outcome_check
  CHECK (outcome IN ('confirmed','changed','cancelled','no_answer','wrong_number','callback','pending','no_reply'));
ALTER TABLE confirmations ADD COLUMN run_id UUID REFERENCES confirmation_runs(id) ON DELETE SET NULL;
