-- The store's copy of an order made in Mizan, as Mizan last saw it (lines, delivery fee, address, name,
-- tags) and the money Mizan itself put on it. Each new read of the copy is compared with it, and only
-- what changed in the store since then updates Mizan's order: an edit made in Mizan that the copy does
-- not have yet (or that the store refused) is never undone, and money Mizan sent is not counted twice.

ALTER TABLE orders ADD COLUMN store_copy_snapshot JSONB;
