-- O1: order lines keep the order they were placed in. Lines were read by their random id, so the
-- order page, the WhatsApp confirmation and pick lists listed items in an arbitrary order.
-- Lines written before this have no position and come after, by id as before.
ALTER TABLE order_lines ADD COLUMN position INT CHECK (position >= 0);
