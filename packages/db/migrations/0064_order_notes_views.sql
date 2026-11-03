-- O2: the team's notes on an order, and saved order filters.
-- A note is the team's, never the store's: it stays in Mizan and is not sent to the store. Its
-- text can name the customer or their address, so it is encrypted like other personal data
-- (pii:v1:…, column "order_notes.body") and deleted with the order's personal data (redaction).
-- A saved view is a named set of list filters: the author's own, or shared with the whole team.

CREATE TABLE order_notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id   UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  author_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  body       TEXT NOT NULL CHECK (body LIKE 'pii:v1:%' AND length(body) <= 16384),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX order_notes_order ON order_notes (order_id, created_at);

CREATE TABLE saved_views (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  screen     TEXT NOT NULL CHECK (screen IN ('orders')),
  name       TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  -- the list's query parameters, as the API takes them ({ "status": "confirmed", "city": "Giza" })
  filters    JSONB NOT NULL CHECK (jsonb_typeof(filters) = 'object'),
  shared     BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, screen, name)
);
CREATE INDEX saved_views_screen ON saved_views (tenant_id, screen);

-- The list's tag filter (O2).
CREATE INDEX orders_tags ON orders USING gin (tags);

ALTER TABLE order_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON order_notes
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE saved_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_views FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON saved_views
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
