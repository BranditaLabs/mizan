-- E12-2a1: the billing catalogue (docs/16 §7.2, §7.6). Platform tables, run by Mizan staff from the
-- back office: the plans, a versioned price book (a price change is a new row, never an edit, so a
-- subscription keeps the price it was sold at through price_id), coupons, the platform billing
-- settings and the public holidays dunning skips. Money: BIGINT minor units + CHAR(3) currency.
-- Limits and features live in code (@mizan/shared plans.ts), not here.

CREATE TABLE plans (
  code        TEXT PRIMARY KEY CHECK (code IN ('free','growth','scale','enterprise')),
  name_ar     TEXT NOT NULL,
  name_en     TEXT NOT NULL,
  rank        SMALLINT NOT NULL UNIQUE,
  is_public   BOOLEAN NOT NULL DEFAULT true          -- shown on the plan picker and the landing
);
INSERT INTO plans (code, name_ar, name_en, rank, is_public) VALUES
  ('free', 'مجاني', 'Free', 0, false),               -- where a store lands after the trial (D3), not sold
  ('growth', 'نمو', 'Growth', 1, true),
  ('scale', 'توسّع', 'Scale', 2, true),
  ('enterprise', 'مؤسسات', 'Enterprise', 3, true);   -- by contract: no price rows

CREATE TABLE plan_prices (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_code          TEXT NOT NULL REFERENCES plans(code),
  kind               TEXT NOT NULL CHECK (kind IN ('base','addon','overage','passthrough')),
  addon_code         TEXT,
  currency           CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  billing_interval   TEXT NOT NULL CHECK (billing_interval IN ('month','year','one_time','per_unit')),
  amount_minor       BIGINT NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
  included_units     INT CHECK (included_units >= 0),          -- orders included in a base price
  unit_amount_minor  BIGINT CHECK (unit_amount_minor >= 0),     -- per order over the included ones
  country            CHAR(2),                                   -- NULL = every country billed in this currency
  valid_from         TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to           TIMESTAMPTZ,
  created_by         UUID REFERENCES platform_staff(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT plan_prices_addon CHECK ((kind = 'addon') = (addon_code IS NOT NULL)),
  CONSTRAINT plan_prices_window CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT plan_prices_unit CHECK (kind <> 'overage' OR (billing_interval = 'per_unit' AND unit_amount_minor IS NOT NULL))
);
-- One live price per plan, kind, add-on, currency, interval and country.
CREATE UNIQUE INDEX plan_prices_live ON plan_prices (plan_code, kind, coalesce(addon_code, ''), currency, billing_interval, coalesce(country, '')) WHERE valid_to IS NULL;

-- Proposals from docs/01 §8, to validate with pilot merchants (EGP 2,500.00 = 250000 piastres).
INSERT INTO plan_prices (plan_code, kind, currency, billing_interval, amount_minor, included_units, unit_amount_minor) VALUES
  ('free',   'base',    'EGP', 'month',    0,        300,   NULL),
  ('free',   'base',    'USD', 'month',    0,        300,   NULL),
  ('growth', 'base',    'EGP', 'month',    250000,   3000,  NULL),
  ('growth', 'base',    'EGP', 'year',     2500000,  3000,  NULL),
  ('growth', 'base',    'USD', 'month',    9900,     3000,  NULL),
  ('growth', 'base',    'USD', 'year',     99000,    3000,  NULL),
  ('growth', 'overage', 'EGP', 'per_unit', 0,        NULL,  75),
  ('growth', 'overage', 'USD', 'per_unit', 0,        NULL,  3),
  ('scale',  'base',    'EGP', 'month',    650000,   10000, NULL),
  ('scale',  'base',    'EGP', 'year',     6500000,  10000, NULL),
  ('scale',  'base',    'USD', 'month',    29900,    10000, NULL),
  ('scale',  'base',    'USD', 'year',     299000,   10000, NULL),
  ('scale',  'overage', 'EGP', 'per_unit', 0,        NULL,  50),
  ('scale',  'overage', 'USD', 'per_unit', 0,        NULL,  2);

-- Coupons. No store can read them: a store redeems a code only through redeem_coupon(), which
-- counts atomically and never lists codes.
CREATE TABLE coupons (
  code              TEXT PRIMARY KEY CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{2,39}$'),
  campaign          TEXT CHECK (campaign ~ '^[a-z][a-z0-9_]{1,40}$'),   -- 'launch', 'brandita_bundle'
  percent_off       SMALLINT CHECK (percent_off BETWEEN 1 AND 100),
  amount_off_minor  BIGINT CHECK (amount_off_minor > 0),
  currency          CHAR(3),
  duration          TEXT NOT NULL CHECK (duration IN ('once','repeating','forever')),
  duration_periods  SMALLINT CHECK (duration_periods BETWEEN 1 AND 36),
  max_redemptions   INT CHECK (max_redemptions > 0),
  redeemed          INT NOT NULL DEFAULT 0 CHECK (redeemed >= 0),
  plans             TEXT[],                                -- NULL = any paid plan
  by_invitation     BOOLEAN NOT NULL DEFAULT false,        -- only stores in coupon_invites may redeem
  agreement_ref     TEXT,
  valid_until       TIMESTAMPTZ,
  active            BOOLEAN NOT NULL DEFAULT true,
  created_by        UUID REFERENCES platform_staff(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT coupons_one_discount CHECK ((percent_off IS NULL) <> (amount_off_minor IS NULL)),
  CONSTRAINT coupons_amount_currency CHECK ((amount_off_minor IS NULL) = (currency IS NULL)),
  CONSTRAINT coupons_repeating CHECK ((duration = 'repeating') = (duration_periods IS NOT NULL)),
  CONSTRAINT coupons_cap CHECK (max_redemptions IS NULL OR redeemed <= max_redemptions)
);

CREATE TABLE coupon_invites (
  coupon_code  TEXT NOT NULL REFERENCES coupons(code) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invited_by   UUID REFERENCES platform_staff(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (coupon_code, tenant_id)
);

CREATE TABLE coupon_redemptions (
  coupon_code  TEXT NOT NULL REFERENCES coupons(code),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  redeemed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (coupon_code, tenant_id)
);

-- The launch offer (owner decision D5): 100% off for 3 periods, at most 50 stores, by invitation.
INSERT INTO coupons (code, campaign, percent_off, duration, duration_periods, max_redemptions, by_invitation)
VALUES ('LAUNCH50', 'launch', 100, 'repeating', 3, 50, true);

-- The platform's billing settings: one row, changed by staff (E12-2f) without a deploy.
CREATE TABLE billing_settings (
  id                     BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  trial_days             SMALLINT NOT NULL DEFAULT 7 CHECK (trial_days BETWEEN 0 AND 90),
  trial_requires_card    BOOLEAN NOT NULL DEFAULT false,
  -- What a trial ends into. read_only arrives with the full scheduler (E12-2d).
  end_of_trial           TEXT NOT NULL DEFAULT 'downgrade_free' CHECK (end_of_trial IN ('downgrade_free')),
  free_tier_public       BOOLEAN NOT NULL DEFAULT false,
  self_extend_days       SMALLINT NOT NULL DEFAULT 3 CHECK (self_extend_days BETWEEN 0 AND 30),
  grace_days             SMALLINT NOT NULL DEFAULT 7 CHECK (grace_days BETWEEN 0 AND 60),
  restricted_days        SMALLINT NOT NULL DEFAULT 30 CHECK (restricted_days BETWEEN 0 AND 365),
  locked_preview_days    SMALLINT NOT NULL DEFAULT 30 CHECK (locked_preview_days BETWEEN 0 AND 365),
  reminder_days          SMALLINT[] NOT NULL DEFAULT '{1,5,6,7,10,14}',
  dunning_retry_days     SMALLINT[] NOT NULL DEFAULT '{1,3,5}',
  existing_store_policy  TEXT NOT NULL DEFAULT 'trial' CHECK (existing_store_policy IN ('trial','free')),
  updated_by             UUID REFERENCES platform_staff(id) ON DELETE SET NULL,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO billing_settings DEFAULT VALUES;

-- Public holidays per country: dunning retries skip them and Fridays (E12-2d). Staff keep them (Platform → Holidays).
CREATE TABLE platform_holidays (
  country  CHAR(2) NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  date     DATE NOT NULL,
  name_ar  TEXT NOT NULL CHECK (char_length(name_ar) BETWEEN 1 AND 120),
  name_en  TEXT NOT NULL CHECK (char_length(name_en) BETWEEN 1 AND 120),
  PRIMARY KEY (country, date)
);

-- Grants. Default privileges (0003) gave mizan_app everything: take it back, then give reads only.
REVOKE ALL ON plans, plan_prices, coupons, coupon_invites, coupon_redemptions, billing_settings, platform_holidays FROM mizan_app, mizan_worker;
GRANT SELECT ON plans, plan_prices, billing_settings TO mizan_app;       -- plans, prices and trial length are public facts
GRANT SELECT ON plans, plan_prices, billing_settings, platform_holidays TO mizan_worker;
GRANT SELECT, INSERT, UPDATE ON plans, plan_prices, coupons, platform_holidays TO mizan_platform;
GRANT DELETE ON platform_holidays TO mizan_platform;
GRANT SELECT, INSERT, DELETE ON coupon_invites TO mizan_platform;
GRANT SELECT ON coupon_redemptions TO mizan_platform;
GRANT SELECT, UPDATE ON billing_settings TO mizan_platform;
-- Invites and redemptions carry a tenant_id but are platform rows: RLS on (not forced, so the owner
-- running redeem_coupon() passes), readable by the back office only.
ALTER TABLE coupon_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupon_redemptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON coupon_invites TO mizan_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_read ON coupon_redemptions FOR SELECT TO mizan_platform USING (true);

-- redeem_coupon: a store redeems a code for itself. Counts atomically (the UPDATE … WHERE redeemed <
-- max holds the row lock), once per store, and answers only the outcome and the discount terms.
CREATE FUNCTION redeem_coupon(p_code TEXT, p_tenant UUID)
RETURNS TABLE (outcome TEXT, percent_off SMALLINT, amount_off_minor BIGINT, currency CHAR(3), duration TEXT, duration_periods SMALLINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  c coupons%ROWTYPE;
BEGIN
  IF p_tenant IS NULL OR p_tenant IS DISTINCT FROM NULLIF(current_setting('app.tenant_id', true), '')::uuid THEN
    RAISE EXCEPTION 'redeem_coupon: a store redeems only for itself' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM coupons WHERE code = upper(p_code);
  IF NOT FOUND OR NOT c.active THEN RETURN QUERY SELECT 'not_found'::text, NULL::smallint, NULL::bigint, NULL::char(3), NULL::text, NULL::smallint; RETURN; END IF;
  IF c.valid_until IS NOT NULL AND c.valid_until <= now() THEN RETURN QUERY SELECT 'expired'::text, NULL::smallint, NULL::bigint, NULL::char(3), NULL::text, NULL::smallint; RETURN; END IF;
  IF c.by_invitation AND NOT EXISTS (SELECT 1 FROM coupon_invites i WHERE i.coupon_code = c.code AND i.tenant_id = p_tenant) THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::smallint, NULL::bigint, NULL::char(3), NULL::text, NULL::smallint; RETURN;   -- an invitation code says nothing to others
  END IF;
  INSERT INTO coupon_redemptions (coupon_code, tenant_id) VALUES (c.code, p_tenant) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN QUERY SELECT 'already_redeemed'::text, NULL::smallint, NULL::bigint, NULL::char(3), NULL::text, NULL::smallint; RETURN; END IF;
  UPDATE coupons SET redeemed = redeemed + 1 WHERE code = c.code AND (max_redemptions IS NULL OR redeemed < max_redemptions);
  IF NOT FOUND THEN
    DELETE FROM coupon_redemptions WHERE coupon_code = c.code AND tenant_id = p_tenant;
    RETURN QUERY SELECT 'exhausted'::text, NULL::smallint, NULL::bigint, NULL::char(3), NULL::text, NULL::smallint; RETURN;
  END IF;
  RETURN QUERY SELECT 'redeemed'::text, c.percent_off, c.amount_off_minor, c.currency, c.duration, c.duration_periods;
END $$;
REVOKE ALL ON FUNCTION redeem_coupon(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION redeem_coupon(TEXT, UUID) TO mizan_app;
