-- P1: the full product. What the store says about a product (its URL name, description, vendor,
-- type, tags, the options its variants differ by) and its pictures in the store's order, one of
-- them the main picture. Store pictures stay on the store's CDN (Mizan keeps their URLs, never the
-- files); a picture added in Mizan has no external_id (P3). Each variant keeps its option values
-- and the picture shown for it.

ALTER TABLE products
  ADD COLUMN handle           TEXT CHECK (length(handle) <= 255),
  ADD COLUMN description_html TEXT,
  ADD COLUMN vendor           TEXT CHECK (length(vendor) <= 255),
  ADD COLUMN product_type     TEXT CHECK (length(product_type) <= 255),
  ADD COLUMN tags             TEXT[] NOT NULL DEFAULT '{}',
  -- [{ "name": "Size", "values": ["S", "M"] }] in the store's order
  ADD COLUMN options          JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(options) = 'array');

CREATE TABLE product_images (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  external_id TEXT,
  url         TEXT NOT NULL CHECK (url ~ '^https://' AND length(url) <= 2048),
  alt         TEXT CHECK (length(alt) <= 512),
  width       INT CHECK (width > 0),
  height      INT CHECK (height > 0),
  position    INT NOT NULL CHECK (position >= 0),
  is_main     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, external_id)
);
CREATE INDEX product_images_product ON product_images (product_id, position);
-- One main picture per product.
CREATE UNIQUE INDEX product_images_one_main ON product_images (product_id) WHERE is_main;

ALTER TABLE variants
  -- [{ "name": "Size", "value": "M" }]
  ADD COLUMN options  JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(options) = 'array'),
  ADD COLUMN image_id UUID REFERENCES product_images(id) ON DELETE SET NULL;

ALTER TABLE product_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_images FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON product_images
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
