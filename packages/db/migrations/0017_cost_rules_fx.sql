-- E9-1 profit inputs: versioned cost rules and daily exchange rates.

-- A rule is never edited in place: a change closes the current version (valid_to) and adds a new
-- one, so profit for an old order is computed with the cost that applied on its day.
ALTER TABLE cost_rules
  ADD COLUMN fixed_minor BIGINT CHECK (fixed_minor >= 0),           -- fixed part of a payment fee ("2.5% + EGP 2")
  ADD COLUMN return_minor BIGINT CHECK (return_minor >= 0),         -- courier rate card: price of the return leg
  ADD COLUMN created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD CONSTRAINT cost_rules_dates CHECK (valid_to IS NULL OR valid_to >= valid_from),
  ADD CONSTRAINT cost_rules_shape CHECK (
    CASE
      WHEN kind IN ('payment_fee_pct', 'cod_fee_pct') THEN pct IS NOT NULL AND pct >= 0 AND pct <= 100
        AND (fixed_minor IS NULL OR currency IS NOT NULL)
      ELSE amount_minor IS NOT NULL AND amount_minor >= 0 AND currency IS NOT NULL AND pct IS NULL
    END
  );
CREATE INDEX cost_rules_active ON cost_rules (tenant_id, kind, valid_from DESC);

-- Daily rates from the FX feed, one row per (day, base, quote): 1 base = rate quote. The feed is
-- fetched with base USD; any other pair is a cross rate. Platform data: no tenant, no RLS.
ALTER TABLE fx_rates ADD CONSTRAINT fx_rates_positive CHECK (rate > 0);
GRANT SELECT, INSERT, UPDATE ON fx_rates TO mizan_worker;

-- A store's own rate for a day (finance override): 1 unit of the store's base currency = rate quote.
CREATE TABLE fx_rate_overrides (
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  day        DATE NOT NULL,
  quote      CHAR(3) NOT NULL,
  rate       NUMERIC(18,8) NOT NULL CHECK (rate > 0),
  set_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  set_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, day, quote)
);

ALTER TABLE fx_rate_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx_rate_overrides FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fx_rate_overrides
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
