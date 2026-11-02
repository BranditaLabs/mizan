-- E8-4c: pick lists and scan-to-pack (M4). Confirmed orders are batched into a pick list whose
-- items are sorted by shelf (bin); on the phone each order's items are scanned, and the order is
-- packed only when what was scanned is exactly what the order holds. Stock still leaves at
-- shipping (E8-2): packing is the check, not a second movement.

ALTER TABLE stock_levels ADD COLUMN bin TEXT CHECK (length(bin) BETWEEN 1 AND 32);

ALTER TABLE orders
  ADD COLUMN packed_at   TIMESTAMPTZ,
  ADD COLUMN packed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN pack_op_id  TEXT;

CREATE TABLE pick_lists (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  number      INT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at   TIMESTAMPTZ,
  UNIQUE (tenant_id, number),
  CONSTRAINT pick_lists_closed CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);
CREATE INDEX pick_lists_open ON pick_lists (tenant_id, created_at DESC) WHERE status = 'open';

CREATE TABLE pick_list_orders (
  pick_list_id UUID NOT NULL REFERENCES pick_lists(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id     UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  PRIMARY KEY (pick_list_id, order_id)
);
CREATE INDEX pick_list_orders_order ON pick_list_orders (tenant_id, order_id);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['pick_lists','pick_list_orders'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;
