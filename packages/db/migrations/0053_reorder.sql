-- M16-4b: reorder suggestions. A counted item is flagged when it falls to its reorder point (one
-- stock.reorder_suggested event per crossing) and unflagged when stock is back over it.
-- An item can carry a pack size: suggestions are rounded up to it.

ALTER TABLE stock_levels ADD COLUMN reorder_flagged_at TIMESTAMPTZ;
ALTER TABLE variants ADD COLUMN reorder_pack_size INT CHECK (reorder_pack_size BETWEEN 1 AND 100000);
