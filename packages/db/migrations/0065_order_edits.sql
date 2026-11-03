-- O3: an order changed before it ships. A manual order changes at once; a store order's edit goes
-- to the store through the outbox (Shopify order edit, WooCommerce update) and the order follows
-- from what the store then says. One edit at a time per order. `changes` holds no personal data
-- (lines, items, the fee); a new delivery address is encrypted like the order's own
-- (pii:v1:…, column "order_edits.address") and removed once the edit is settled.

CREATE TABLE order_edits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  requested_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'applied', 'failed')),
  -- { lines: [{ lineId, quantity, unitPrice? }], add: [{ variantId, quantity, unitPrice? }], shipping?, address: bool }
  changes       JSONB NOT NULL CHECK (jsonb_typeof(changes) = 'object'),
  address       TEXT CHECK (address IS NULL OR address LIKE 'pii:v1:%'),
  -- why the store refused it (validation, not_found, permission, failed), and its words
  failure       TEXT CHECK (failure IS NULL OR failure IN ('validation', 'not_found', 'permission', 'failed')),
  failure_message TEXT CHECK (length(failure_message) <= 1000),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at    TIMESTAMPTZ,
  CHECK ((status = 'sending') = (settled_at IS NULL)),
  CHECK ((status = 'failed') = (failure IS NOT NULL))
);
CREATE INDEX order_edits_order ON order_edits (order_id, created_at DESC);
-- One edit on its way per order.
CREATE UNIQUE INDEX order_edits_one_sending ON order_edits (order_id) WHERE status = 'sending';

ALTER TABLE order_edits ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_edits FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON order_edits
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
