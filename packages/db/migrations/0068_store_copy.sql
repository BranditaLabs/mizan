-- An order made in Mizan (typed by the team) is created in the store too, so Shopify, Mizan and the
-- courier keep the same record. The order stays Mizan's (its own id and number, money in Mizan's
-- ledger); these columns point at its copy in the store. The store's copy carries Mizan's id, so
-- when the store sends it back it is linked here, never imported as a second order; a store id
-- links one Mizan order at most.

ALTER TABLE orders
  ADD COLUMN store_copy_connection_id UUID REFERENCES connections(id) ON DELETE SET NULL,
  ADD COLUMN store_copy_id     TEXT,
  ADD COLUMN store_copy_name   TEXT,
  ADD COLUMN store_copy_status TEXT CHECK (store_copy_status IN ('pending', 'created', 'failed')),
  ADD COLUMN store_copy_error  TEXT CHECK (char_length(store_copy_error) <= 500);

CREATE UNIQUE INDEX orders_store_copy ON orders (store_copy_connection_id, store_copy_id) WHERE store_copy_id IS NOT NULL;
CREATE INDEX orders_store_copy_pending ON orders (tenant_id, created_at) WHERE store_copy_status = 'pending';
