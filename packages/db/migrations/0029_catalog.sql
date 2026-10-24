-- E8-1 catalogue: barcodes and who owns them.
-- The store owns title, price, SKU and status; Mizan owns the cost. The barcode is the store's
-- until the merchant sets it in Mizan (barcode_set_at), then store syncs leave it alone.
ALTER TABLE variants ADD COLUMN barcode_set_at TIMESTAMPTZ;

-- Scanning finds one variant per barcode in a store.
CREATE UNIQUE INDEX variants_barcode ON variants (tenant_id, barcode) WHERE barcode IS NOT NULL;
CREATE INDEX products_title ON products (tenant_id, title, id);
