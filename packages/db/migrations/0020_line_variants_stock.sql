-- Order lines learn which product they are (profit, offers): the store's variant id is kept on
-- the line, so a line that arrives before its product is linked when the product is read.
ALTER TABLE order_lines ADD COLUMN external_variant_id TEXT;
CREATE INDEX order_lines_unlinked ON order_lines (tenant_id, external_variant_id) WHERE variant_id IS NULL AND external_variant_id IS NOT NULL;

-- Stock as the store last reported it (offers skip what is sold out). NULL = not known.
ALTER TABLE variants
  ADD COLUMN available    INT,
  ADD COLUMN available_at TIMESTAMPTZ;
