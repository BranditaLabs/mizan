-- M7-2: where each order came from. The order projector resolves the store's hints (customer
-- journey, UTM tags, referrer, click ids, the sales channel) with resolveOrderSource and keeps one
-- row per order: the platform, paid or organic, which rule decided, the campaign tags, and the first
-- touch when it differs. Never a full URL (queries can carry an email or a phone): the landing path,
-- the referrer's domain, and the ad click id, which is cleared when the order's personal data is.
CREATE TABLE order_sources (
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id         UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  platform         TEXT NOT NULL CHECK (platform IN ('meta','tiktok','snapchat','google','microsoft','x','whatsapp','email','sms','search','social','referral','direct','pos','manual','unknown')),
  paid             BOOLEAN,
  rule             TEXT NOT NULL CHECK (rule IN ('click_id','utm','referrer','store','channel','none')),
  utm_source       TEXT CHECK (char_length(utm_source) <= 200),
  utm_medium       TEXT CHECK (char_length(utm_medium) <= 200),
  utm_campaign     TEXT CHECK (char_length(utm_campaign) <= 200),
  utm_content      TEXT CHECK (char_length(utm_content) <= 200),
  utm_term         TEXT CHECK (char_length(utm_term) <= 200),
  utm_id           TEXT CHECK (char_length(utm_id) <= 200),
  click_id_kind    TEXT CHECK (click_id_kind IN ('fbclid','gclid','gbraid','wbraid','ttclid','sccid','msclkid','twclid')),
  click_id         TEXT CHECK (char_length(click_id) <= 500),
  referrer_domain  TEXT CHECK (char_length(referrer_domain) <= 253),
  landing_path     TEXT CHECK (char_length(landing_path) <= 500),
  first_platform   TEXT CHECK (first_platform IN ('meta','tiktok','snapchat','google','microsoft','x','whatsapp','email','sms','search','social','referral','direct','pos','manual','unknown')),
  first_seen_at    TIMESTAMPTZ,
  discount_codes   TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(discount_codes) <= 20),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, order_id),
  CONSTRAINT order_sources_click CHECK (click_id IS NULL OR click_id_kind IS NOT NULL)
);
CREATE INDEX order_sources_campaign ON order_sources (tenant_id, platform, utm_campaign);
CREATE UNIQUE INDEX order_sources_order ON order_sources (order_id);

ALTER TABLE order_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_sources FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON order_sources
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
