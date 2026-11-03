-- P3: products made in Mizan, with pictures the team uploads, published to a store later.
-- A picture is checked and resized by the API (never stored as uploaded: re-encoded, metadata such
-- as GPS dropped) and kept as two files, the picture and its thumbnail. The bytes live in Azure
-- Blob Storage when it is configured, else in `data` (development, tests, a store without Blob).
-- Product pictures are public (stores show them to everyone): served at /media/<tenant>/<key>.

CREATE TABLE media_objects (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key          TEXT NOT NULL CHECK (key ~ '^[a-z0-9][a-z0-9/_.-]{0,199}$' AND key !~ '\.\.'),
  content_type TEXT NOT NULL CHECK (content_type IN ('image/webp', 'image/jpeg', 'image/png')),
  bytes        INT NOT NULL CHECK (bytes > 0 AND bytes <= 20971520),
  width        INT CHECK (width > 0),
  height       INT CHECK (height > 0),
  -- where the bytes are: here (data) or in Blob Storage under the same key
  storage      TEXT NOT NULL CHECK (storage IN ('db', 'blob')),
  data         BYTEA,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key),
  CHECK ((storage = 'db') = (data IS NOT NULL))
);

ALTER TABLE product_images
  ADD COLUMN media_id  UUID REFERENCES media_objects(id) ON DELETE SET NULL,
  ADD COLUMN thumb_url TEXT CHECK (thumb_url ~ '^https?://' AND length(thumb_url) <= 2048);
-- A picture uploaded to Mizan is served by the API (http in development); a store's stays https.
ALTER TABLE product_images DROP CONSTRAINT IF EXISTS product_images_url_check;
ALTER TABLE product_images ADD CONSTRAINT product_images_url_check
  CHECK ((url ~ '^https://' OR (media_id IS NOT NULL AND url ~ '^http://')) AND length(url) <= 2048);

ALTER TABLE products
  -- the store a product made in Mizan is going to, how far it got, and why it failed
  ADD COLUMN publish_connection_id UUID REFERENCES connections(id) ON DELETE SET NULL,
  ADD COLUMN publish_status        TEXT CHECK (publish_status IN ('publishing', 'published', 'failed')),
  ADD COLUMN publish_error         TEXT CHECK (length(publish_error) <= 1000),
  ADD COLUMN publish_attempts      INT NOT NULL DEFAULT 0 CHECK (publish_attempts >= 0),
  -- Shopify: put on the Online Store when published (false: draft, no Online Store, or the permission not approved yet)
  ADD COLUMN publish_online_store  BOOLEAN;

ALTER TABLE media_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_objects FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON media_objects
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
