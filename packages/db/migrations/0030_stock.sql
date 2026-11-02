-- E8-2 stock: what each order holds, and why a manual movement was made.
-- A variant is counted by Mizan once it has a stock_levels row (received or counted here);
-- until then its stock is the store's and orders do not reserve it.

-- reserved: every counted item is held; short: a counted item was not available (nothing new is
-- held until stock arrives); untracked: none of its items is counted here; NULL: not confirmed.
ALTER TABLE orders ADD COLUMN stock_status TEXT CHECK (stock_status IN ('reserved','short','untracked'));
CREATE INDEX orders_stock_short ON orders (tenant_id, placed_at) WHERE stock_status = 'short';

-- count / adjust reason (damaged, lost, found, correction, other) and a short note.
-- seq: the order movements were written, also within one transaction (their times can be equal).
ALTER TABLE stock_movements ADD COLUMN detail TEXT, ADD COLUMN note TEXT CHECK (length(note) <= 200),
  ADD COLUMN seq BIGINT GENERATED ALWAYS AS IDENTITY;
CREATE INDEX stock_movements_ref ON stock_movements (tenant_id, ref_id) WHERE ref_id IS NOT NULL;
CREATE INDEX stock_movements_variant ON stock_movements (tenant_id, variant_id, seq DESC);
