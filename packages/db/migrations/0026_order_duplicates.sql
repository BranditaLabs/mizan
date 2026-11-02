-- E5-3: likely duplicate orders. When an order arrives, an earlier order of the same customer
-- (matched by phone) with the same product within the store's window (48 h by default) makes it a
-- suspected duplicate of that order: held from confirmation until the team keeps or merges it.
-- duplicate_of (0001) points at the earlier order; the reason keeps what matched (no personal data).
ALTER TABLE orders ADD COLUMN duplicate_status TEXT CHECK (duplicate_status IN ('suspected','kept','merged'));
ALTER TABLE orders ADD COLUMN duplicate_reason JSONB;
ALTER TABLE orders ADD CONSTRAINT orders_duplicate_shape CHECK ((duplicate_status IS NULL) = (duplicate_of IS NULL) AND duplicate_of <> id);
CREATE INDEX orders_duplicates ON orders (tenant_id, placed_at DESC) WHERE duplicate_status = 'suspected';
CREATE INDEX orders_customer_recent ON orders (tenant_id, customer_id, placed_at DESC) WHERE customer_id IS NOT NULL;
