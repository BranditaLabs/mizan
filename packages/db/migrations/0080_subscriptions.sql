-- E12-2a1: subscriptions (docs/16 §7.3, §7.6). One live subscription per store; every change goes
-- through SubscriptionService.transition() (apps/api billing/state.ts), which version-checks the row,
-- appends a subscription_events line and is the only writer of tenants.plan (= the plan the
-- subscription entitles). One trial per owner, phone and shop domain: trials_used holds peppered
-- HMACs and no store can read it; claim_trial() is the only way in.

CREATE TABLE subscriptions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_code             TEXT NOT NULL REFERENCES plans(code),
  billing_interval      TEXT NOT NULL DEFAULT 'month' CHECK (billing_interval IN ('month','year')),
  status                TEXT NOT NULL CHECK (status IN ('trialing','active','past_due','restricted','paused','cancelled','expired','incomplete')),
  previous_status       TEXT CHECK (previous_status IN ('trialing','active','past_due','restricted','paused')),   -- while incomplete
  price_id              UUID REFERENCES plan_prices(id),     -- grandfathered price, set at the first checkout
  currency              CHAR(3),                             -- locked at the first checkout
  comp_percent          SMALLINT NOT NULL DEFAULT 0 CHECK (comp_percent BETWEEN 0 AND 100),   -- staff comp (pilots: 100)
  trial_started_at      TIMESTAMPTZ,
  trial_ends_at         TIMESTAMPTZ,
  current_period_start  TIMESTAMPTZ,
  current_period_end    TIMESTAMPTZ,
  cancel_at_period_end  BOOLEAN NOT NULL DEFAULT false,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at              TIMESTAMPTZ,
  version               INT NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT subscriptions_trial CHECK (status <> 'trialing' OR (trial_started_at IS NOT NULL AND trial_ends_at > trial_started_at)),
  CONSTRAINT subscriptions_incomplete CHECK ((status = 'incomplete') = (previous_status IS NOT NULL)),
  CONSTRAINT subscriptions_ended CHECK ((status IN ('cancelled','expired')) = (ended_at IS NOT NULL)),
  CONSTRAINT subscriptions_period CHECK (current_period_end IS NULL OR current_period_end > current_period_start)
);
-- One live subscription per store; the scheduler's due queues.
CREATE UNIQUE INDEX subscriptions_live ON subscriptions (tenant_id) WHERE status NOT IN ('cancelled','expired');
-- A trial with a checkout open (incomplete, previous_status trialing) still ends at trial_ends_at.
CREATE INDEX subscriptions_trial_due ON subscriptions (trial_ends_at) WHERE status IN ('trialing','incomplete');
CREATE INDEX subscriptions_period_due ON subscriptions (current_period_end) WHERE status IN ('active','past_due','restricted');

-- Every change, append-only (kept 10 years with invoices, docs/16 §7.5). NO ACTION, not CASCADE: a
-- subscription with history cannot be deleted, so the history cannot vanish through the key.
CREATE TABLE subscription_events (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subscription_id  UUID NOT NULL REFERENCES subscriptions(id) ON DELETE NO ACTION,
  event            TEXT NOT NULL CHECK (event ~ '^[a-z_]{3,40}$'),
  from_status      TEXT,
  to_status        TEXT NOT NULL,
  from_plan        TEXT,
  to_plan          TEXT NOT NULL,
  version          INT NOT NULL,
  actor_type       TEXT NOT NULL CHECK (actor_type IN ('user','mizan_staff','system')),
  actor_id         UUID,
  reason           TEXT CHECK (char_length(reason) <= 500),
  data             JSONB NOT NULL DEFAULT '{}',
  at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX subscription_events_sub ON subscription_events (subscription_id, id);
CREATE INDEX subscription_events_tenant ON subscription_events (tenant_id, at DESC);
-- The scheduler's one-off claim of backfilled trials' keys (BillingScheduler.claimBackfilledKeys).
CREATE INDEX subscription_events_backfill ON subscription_events (subscription_id) WHERE event IN ('backfill','trial_keys_claimed');

-- What staff changed by hand for a store (a limit raised, a trial granted), with why and until when.
CREATE TABLE subscription_overrides (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key         TEXT NOT NULL CHECK (key ~ '^[a-z][a-z0-9_.]{2,60}$'),
  value       JSONB NOT NULL,
  reason      TEXT NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500),
  staff_id    UUID REFERENCES platform_staff(id) ON DELETE SET NULL,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX subscription_overrides_tenant ON subscription_overrides (tenant_id, key);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['subscriptions','subscription_events','subscription_overrides'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    EXECUTE format('GRANT SELECT ON %I TO mizan_platform', t);
    EXECUTE format('CREATE POLICY platform_read ON %I FOR SELECT TO mizan_platform USING (true)', t);
  END LOOP;
END $$;

-- The history is append-only for the store's own role, and a subscription is never deleted (it
-- ends: cancelled or expired). Overrides are what staff changed by hand: the store only reads them.
REVOKE UPDATE, DELETE ON subscription_events FROM mizan_app;
REVOKE DELETE ON subscriptions FROM mizan_app;
REVOKE INSERT, UPDATE, DELETE ON subscription_overrides FROM mizan_app;
GRANT INSERT ON subscription_overrides TO mizan_platform;
CREATE POLICY platform_write ON subscription_overrides FOR INSERT TO mizan_platform WITH CHECK (true);

-- The scheduler (worker role) finds due trials across stores: ids and times only, then acts in each store's own context.
REVOKE ALL ON subscriptions, subscription_events, subscription_overrides FROM mizan_worker;
GRANT SELECT (id, tenant_id, status, previous_status, trial_ends_at, current_period_end) ON subscriptions TO mizan_worker;
CREATE POLICY worker_due ON subscriptions FOR SELECT TO mizan_worker USING (true);
-- ...and the backfilled subscriptions whose trial keys are not claimed yet: ids and event names only.
GRANT SELECT (tenant_id, subscription_id, event, to_plan) ON subscription_events TO mizan_worker;
CREATE POLICY worker_due ON subscription_events FOR SELECT TO mizan_worker USING (true);

-- One trial per owner, phone and shop domain (docs/16 §7.6). key_hash = '<kind>:' + HMAC-SHA256 with
-- the platform pepper (TRIAL_KEY_PEPPER), never a plain hash. No role but the owner can read it.
CREATE TABLE trials_used (
  key_hash    TEXT PRIMARY KEY CHECK (key_hash ~ '^(user|phone|shop_domain):[0-9a-f]{64}$'),
  kind        TEXT NOT NULL CHECK (kind IN ('user','phone','shop_domain')),
  tenant_id   UUID NOT NULL,              -- no foreign key: a deleted store's claim still counts
  claimed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT trials_used_kind CHECK (key_hash LIKE kind || ':%')
);
REVOKE ALL ON trials_used FROM mizan_app, mizan_worker, mizan_platform;
ALTER TABLE trials_used ENABLE ROW LEVEL SECURITY;   -- and no policy: only the owner (claim_trial) reaches a row

-- claim_trial: record every key for this store, or none when any was claimed by another store.
-- Answers only true/false, never which store. Two signups racing on a key: the second waits on the
-- unique index, then sees the first's row and gets false (its own inserts roll back with the block).
CREATE FUNCTION claim_trial(key_hashes TEXT[], tenant UUID) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF tenant IS NULL OR tenant IS DISTINCT FROM NULLIF(current_setting('app.tenant_id', true), '')::uuid THEN
    RAISE EXCEPTION 'claim_trial: a store claims only for itself' USING ERRCODE = '42501';
  END IF;
  IF key_hashes IS NULL OR cardinality(key_hashes) = 0 THEN RETURN false; END IF;
  BEGIN
    INSERT INTO trials_used (key_hash, kind, tenant_id)
      SELECT DISTINCT k, split_part(k, ':', 1), tenant FROM unnest(key_hashes) AS k
      ON CONFLICT (key_hash) DO NOTHING;
    IF EXISTS (SELECT 1 FROM trials_used u WHERE u.key_hash = ANY (key_hashes) AND u.tenant_id <> tenant) THEN
      RAISE EXCEPTION 'trial already used' USING ERRCODE = 'P0001';
    END IF;
    RETURN true;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    RETURN false;
  END;
END $$;
REVOKE ALL ON FUNCTION claim_trial(TEXT[], UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_trial(TEXT[], UUID) TO mizan_app;

-- tenants.plan has one writer: the subscription service sets mizan.plan_writer for its own
-- transaction. Anything else that changes the plan is refused.
CREATE FUNCTION tenants_plan_one_writer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.plan IS DISTINCT FROM OLD.plan AND coalesce(current_setting('mizan.plan_writer', true), '') <> 'subscription' THEN
    RAISE EXCEPTION 'tenants.plan is written only by the subscription service' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tenants_plan_one_writer BEFORE UPDATE OF plan ON tenants FOR EACH ROW EXECUTE FUNCTION tenants_plan_one_writer();

-- Staff change plans through the subscription service now (E12-2a3), not by writing tenants.plan.
REVOKE UPDATE ON tenants FROM mizan_platform;
GRANT UPDATE (status, updated_at) ON tenants TO mizan_platform;

-- Backfill (owner decision D18): every store gets one live subscription.
--   * a store staff already moved to a paid plan keeps it: active, comped 100%;
--   * every other store: a fresh trial of Growth from today (day 1) to 23:59:59 on day 7 in the
--     store's time zone, or Free when the migration runs with mizan.existing_store_policy = 'free'
--     (PGOPTIONS='-c mizan.existing_store_policy=free'), which grandfathers them instead;
--   * deleted stores: Free (tenants.plan follows, so tenants.plan = the plan the subscription entitles).
-- trials_used cannot be filled here (the HMAC pepper lives only in the app): the billing scheduler
-- claims the owner's and connected shops' keys for every backfilled paid or trial subscription on its
-- first tick, once (a trial_keys_claimed history line), so a backfilled owner gets no second trial.
-- Pilots move to comped Scale by a staff action before gating is turned on.
DO $$
DECLARE
  policy TEXT := coalesce(NULLIF(current_setting('mizan.existing_store_policy', true), ''), 'trial');
BEGIN
  IF policy NOT IN ('trial', 'free') THEN RAISE EXCEPTION 'mizan.existing_store_policy must be trial or free'; END IF;
  UPDATE billing_settings SET existing_store_policy = policy;
  PERFORM set_config('mizan.plan_writer', 'subscription', true);

  INSERT INTO subscriptions (tenant_id, plan_code, status, comp_percent, current_period_start)
    SELECT id, plan, 'active', 100, now() FROM tenants WHERE status <> 'deleted' AND plan <> 'free';

  IF policy = 'trial' THEN
    INSERT INTO subscriptions (tenant_id, plan_code, status, trial_started_at, trial_ends_at)
      SELECT id, 'growth', 'trialing', now(), ((((now() AT TIME ZONE timezone)::date + 7)::timestamp) AT TIME ZONE timezone) - interval '1 second'
      FROM tenants WHERE status <> 'deleted' AND plan = 'free';
    UPDATE tenants SET plan = 'growth' WHERE status <> 'deleted' AND plan = 'free';
  END IF;

  INSERT INTO subscriptions (tenant_id, plan_code, status, current_period_start)
    SELECT t.id, 'free', 'active', now() FROM tenants t
    WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id = t.id);
  -- A deleted store staff had moved to a paid plan is Free now: tenants.plan follows its subscription.
  UPDATE tenants t SET plan = 'free' WHERE t.plan <> 'free'
    AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id = t.id AND s.plan_code = 'free' AND s.status = 'active');

  INSERT INTO subscription_events (tenant_id, subscription_id, event, to_status, to_plan, version, actor_type, reason, data)
    SELECT tenant_id, id, 'backfill', status, plan_code, 1, 'system', 'subscriptions launched (D18)', jsonb_build_object('policy', policy)
    FROM subscriptions;
END $$;
