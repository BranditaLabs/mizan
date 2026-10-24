-- E5-8: nightly reconciliation. Per store connection and store day: how many orders the store
-- created, how many the engine recovered (webhooks lost on the way, now ingested), and how many
-- Mizan holds after that. A gap left means orders are still missing or extra: ops is told.
CREATE TABLE order_reconciliations (
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id   UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  day             DATE NOT NULL,
  store_orders    INT NOT NULL CHECK (store_orders >= 0),
  recovered       INT NOT NULL DEFAULT 0 CHECK (recovered >= 0),
  mizan_orders    INT NOT NULL CHECK (mizan_orders >= 0),
  gap             INT GENERATED ALWAYS AS (store_orders - mizan_orders) STORED,
  checked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, day)
);
CREATE INDEX order_reconciliations_recent ON order_reconciliations (tenant_id, day DESC);
ALTER TABLE order_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_reconciliations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON order_reconciliations
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
