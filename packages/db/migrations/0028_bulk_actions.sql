-- E5-4: bulk actions on orders (assign, tag, confirm, cancel), run in chunks by the worker so the
-- team sees progress. One row per action, one per order with its outcome and, when skipped or
-- failed, why (a code, never personal data).
CREATE TABLE bulk_actions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  action          TEXT NOT NULL CHECK (action IN ('assign','tag','confirm','cancel')),
  params          JSONB NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','done')),
  total           INT NOT NULL CHECK (total > 0),
  done            INT NOT NULL DEFAULT 0,
  skipped         INT NOT NULL DEFAULT 0,
  failed          INT NOT NULL DEFAULT 0,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  CONSTRAINT bulk_actions_counts CHECK (done + skipped + failed <= total)
);
CREATE INDEX bulk_actions_recent ON bulk_actions (tenant_id, created_at DESC);

CREATE TABLE bulk_action_items (
  bulk_id         UUID NOT NULL REFERENCES bulk_actions(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','skipped','failed')),
  reason          TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bulk_id, order_id)
);
CREATE INDEX bulk_action_items_pending ON bulk_action_items (bulk_id) WHERE status = 'pending';

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['bulk_actions','bulk_action_items'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;
