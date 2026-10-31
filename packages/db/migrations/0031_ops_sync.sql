-- E8-3: operations from the ops app (offline-first). Each op carries a client-made op_id; the
-- first sync applies it and stores the outcome, any replay returns that same outcome.
CREATE TABLE ops_operations (
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  op_id       TEXT NOT NULL CHECK (length(op_id) BETWEEN 8 AND 64),
  device_id   TEXT NOT NULL CHECK (length(device_id) BETWEEN 1 AND 64),
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  type        TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('applied','rejected','conflict')),
  code        TEXT,
  result      JSONB,
  client_at   TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, op_id)
);
CREATE INDEX ops_operations_device ON ops_operations (tenant_id, device_id, received_at DESC);

ALTER TABLE ops_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_operations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ops_operations
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
