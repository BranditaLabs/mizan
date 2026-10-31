-- E2-7: several Shopify stores per tenant. The engine runs once per store connection, so its
-- rows are scoped per store too: two stores' cursors, backfill state, product state, webhook
-- dedupe keys and idempotency keys never collide, and each store's jobs run in that store's
-- engine. scope = the store's connection id ('' for the standalone engine). Rows written before
-- belong to the tenant's first Shopify store (one store per tenant until now).

ALTER TABLE mz_records ADD COLUMN scope TEXT NOT NULL DEFAULT '';
ALTER TABLE mz_inbound_events ADD COLUMN scope TEXT NOT NULL DEFAULT '';
ALTER TABLE mz_outbox ADD COLUMN scope TEXT NOT NULL DEFAULT '';

WITH first_store AS (
  SELECT DISTINCT ON (tenant_id) tenant_id, id::text AS scope FROM connections
  WHERE provider = 'shopify' ORDER BY tenant_id, created_at
)
UPDATE mz_records r SET scope = f.scope FROM first_store f WHERE r.tenant_id = f.tenant_id;
WITH first_store AS (
  SELECT DISTINCT ON (tenant_id) tenant_id, id::text AS scope FROM connections
  WHERE provider = 'shopify' ORDER BY tenant_id, created_at
)
UPDATE mz_inbound_events e SET scope = f.scope FROM first_store f WHERE e.tenant_id = f.tenant_id;
WITH first_store AS (
  SELECT DISTINCT ON (tenant_id) tenant_id, id::text AS scope FROM connections
  WHERE provider = 'shopify' ORDER BY tenant_id, created_at
)
UPDATE mz_outbox o SET scope = f.scope FROM first_store f WHERE o.tenant_id = f.tenant_id;

ALTER TABLE mz_records DROP CONSTRAINT mz_records_pkey;
ALTER TABLE mz_records ADD PRIMARY KEY (tenant_id, scope, type, key);
ALTER TABLE mz_inbound_events DROP CONSTRAINT mz_inbound_events_pkey;
ALTER TABLE mz_inbound_events ADD PRIMARY KEY (tenant_id, scope, key);
ALTER TABLE mz_outbox DROP CONSTRAINT mz_outbox_tenant_idempotency_key;
ALTER TABLE mz_outbox ADD CONSTRAINT mz_outbox_scope_idempotency_key UNIQUE (tenant_id, scope, idempotency_key);
DROP INDEX mz_outbox_tenant_due;
CREATE INDEX mz_outbox_scope_due ON mz_outbox (tenant_id, scope, next_attempt_at) WHERE status IN ('pending','running');

-- The worker reads which store has due jobs and prunes dedupe keys by their full key.
GRANT SELECT (tenant_id, scope, key, received_at) ON mz_inbound_events TO mizan_worker;
