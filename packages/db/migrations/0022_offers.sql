-- E6-11 upsell and cross-sell at confirmation (M2). The owner's rules come first ("an order with
-- this abaya → offer the matching scarf at 10% off"); without a rule, Mizan recommends what is
-- bought together. One offer per confirmation run, shown in the WhatsApp chat right after the
-- customer confirms and in the team's call script.

CREATE TABLE offer_rules (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- NULL = any order.
  trigger_variant_id  UUID REFERENCES variants(id) ON DELETE CASCADE,
  offer_variant_id    UUID NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  discount_pct        NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 50),
  priority            INT NOT NULL DEFAULT 0,
  -- Optional wording; else Mizan writes it (E6-12: Claude).
  message_ar          TEXT CHECK (char_length(message_ar) <= 300),
  message_en          TEXT CHECK (char_length(message_en) <= 300),
  active              BOOLEAN NOT NULL DEFAULT true,
  created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT offer_rules_not_self CHECK (trigger_variant_id IS NULL OR trigger_variant_id <> offer_variant_id)
);
CREATE INDEX offer_rules_active ON offer_rules (tenant_id, priority DESC) WHERE active;

CREATE TABLE order_offers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id          UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  run_id            UUID NOT NULL REFERENCES confirmation_runs(id) ON DELETE CASCADE,
  rule_id           UUID REFERENCES offer_rules(id) ON DELETE SET NULL,
  variant_id        UUID NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  qty               SMALLINT NOT NULL DEFAULT 1 CHECK (qty BETWEEN 1 AND 10),
  currency          CHAR(3) NOT NULL,
  unit_price_minor  BIGINT NOT NULL CHECK (unit_price_minor >= 0),
  discount_pct      NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 50),
  -- What the customer pays for one, after the discount: the price they were shown, never more.
  offer_price_minor BIGINT NOT NULL CHECK (offer_price_minor >= 0 AND offer_price_minor <= unit_price_minor),
  source            TEXT NOT NULL CHECK (source IN ('rule','auto','ai')),
  message_ar        TEXT,
  message_en        TEXT,
  status            TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','accepted','declined','expired','applying','applied','failed')),
  channel           TEXT CHECK (channel IN ('whatsapp','call_team','agent')),
  decided_at        TIMESTAMPTZ,
  decided_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  shopify_ref       TEXT,
  error             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id)
);
CREATE INDEX order_offers_order ON order_offers (tenant_id, order_id);
CREATE INDEX order_offers_recent ON order_offers (tenant_id, created_at DESC);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['offer_rules','order_offers'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

-- "Bought together" for recommendations: lines of the same order by variant.
CREATE INDEX order_lines_variant ON order_lines (tenant_id, variant_id) WHERE variant_id IS NOT NULL;
