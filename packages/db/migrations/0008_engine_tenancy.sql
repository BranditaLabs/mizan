-- Engine tables inside the platform (E2-1). 0001 created them with a nullable
-- tenant_id and global keys, so two stores' idempotency keys and records
-- (e.g. "order:<shopify id>", the poll cursor) would collide. Make every key
-- per tenant, link jobs to their connection, and put the tables under RLS.
-- The tables are empty before E2 (the engine ran standalone), so the
-- constraints apply without a backfill.

-- Inbound webhook dedupe keys
ALTER TABLE mz_inbound_events ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE mz_inbound_events ADD CONSTRAINT mz_inbound_events_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE mz_inbound_events DROP CONSTRAINT mz_inbound_events_pkey;
ALTER TABLE mz_inbound_events ADD PRIMARY KEY (tenant_id, key);

-- Outbox jobs
ALTER TABLE mz_outbox ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE mz_outbox ADD CONSTRAINT mz_outbox_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE mz_outbox ADD COLUMN connection_id UUID REFERENCES connections(id) ON DELETE CASCADE;
ALTER TABLE mz_outbox DROP CONSTRAINT mz_outbox_idempotency_key_key;
ALTER TABLE mz_outbox ADD CONSTRAINT mz_outbox_tenant_idempotency_key UNIQUE (tenant_id, idempotency_key);
CREATE INDEX mz_outbox_tenant_status ON mz_outbox (tenant_id, status);
CREATE INDEX mz_outbox_connection ON mz_outbox (connection_id) WHERE status IN ('pending','running');

-- Records (canonical snapshots, cursors, product state)
ALTER TABLE mz_records ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE mz_records ADD CONSTRAINT mz_records_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE mz_records DROP CONSTRAINT mz_records_pkey;
ALTER TABLE mz_records ADD PRIMARY KEY (tenant_id, type, key);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['mz_inbound_events','mz_outbox','mz_records'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

-- The platform worker claims due jobs across tenants (like domain events, 0006),
-- then runs each job inside its tenant's context.
GRANT SELECT, UPDATE ON mz_outbox TO mizan_worker;
CREATE POLICY worker_claim ON mz_outbox TO mizan_worker USING (true) WITH CHECK (true);
