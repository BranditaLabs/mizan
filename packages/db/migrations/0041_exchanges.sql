-- E10-2: exchanges (M6). The customer sends items back and gets others: a replacement order linked
-- to the original both ways. What they already paid for the returned items moves as store credit
-- (a refund line on the original, a sale line on the replacement, both store_credit), so revenue
-- is never counted twice; the price difference is collected on delivery or is a refund due.
-- The exchange waits for the items to come back (return inspection on the original order).
CREATE TABLE exchanges (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  original_order_id     UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  replacement_order_id  UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  ticket_id             UUID REFERENCES tickets(id),
  reason                TEXT NOT NULL,
  note                  TEXT CHECK (length(note) <= 300),
  items                 JSONB NOT NULL,           -- [{ lineId, quantity }] coming back from the original
  status                TEXT NOT NULL DEFAULT 'awaiting_return' CHECK (status IN ('awaiting_return','returned')),
  currency              CHAR(3) NOT NULL,
  returned_value_minor  BIGINT NOT NULL CHECK (returned_value_minor >= 0),
  credit_minor          BIGINT NOT NULL CHECK (credit_minor >= 0),   -- moved to the replacement
  refund_due_minor      BIGINT NOT NULL DEFAULT 0 CHECK (refund_due_minor >= 0),
  created_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  returned_at           TIMESTAMPTZ
);
CREATE INDEX exchanges_original ON exchanges (original_order_id);

ALTER TABLE exchanges ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchanges FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON exchanges
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
