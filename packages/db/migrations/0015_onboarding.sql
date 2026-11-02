-- E4-5 onboarding: Shopify products in Mizan's catalogue, costs the merchant entered, product events.

-- A product synced from a store keeps its origin, so a later sync updates it instead of adding a copy.
ALTER TABLE products
  ADD COLUMN connection_id UUID REFERENCES connections(id) ON DELETE SET NULL,
  ADD COLUMN external_id   TEXT;
CREATE UNIQUE INDEX products_external ON products (tenant_id, connection_id, external_id) WHERE external_id IS NOT NULL;

-- When the merchant entered the cost: cogs_minor = 0 is either a free item or nothing entered yet.
-- Mizan owns costs; store syncs never touch cogs_minor or cogs_set_at.
ALTER TABLE variants ADD COLUMN cogs_set_at TIMESTAMPTZ;
CREATE INDEX variants_missing_cost ON variants (tenant_id, created_at) WHERE cogs_set_at IS NULL;

-- Product events (docs/02 §8): ids and business facts only, never personal data. Milestones
-- (signup, store_connected, first_order_synced …) carry a dedupe key, so replays record them once.
CREATE TABLE product_events (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         TEXT NOT NULL CHECK (name ~ '^[a-z][a-z_]*$'),
  dedupe_key   TEXT,
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  data         JSONB NOT NULL DEFAULT '{}',
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX product_events_dedupe ON product_events (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX product_events_name ON product_events (name, occurred_at);

ALTER TABLE product_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON product_events
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
