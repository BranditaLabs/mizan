-- Mizan core schema, migration 0001.
-- Conventions: see docs/04-data-model.md.
--   * every business table has tenant_id + RLS policy
--   * money = BIGINT minor units + CHAR(3) currency
--   * timestamps = TIMESTAMPTZ, UTC
--   * ids = UUID (gen_random_uuid)
--   * external ids stored as TEXT next to the connection that issued them

-- gen_random_uuid() is built in since PostgreSQL 13; no extension needed.

-- ───────────────────────── Tenancy and identity ─────────────────────────

CREATE TABLE tenants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  country         CHAR(2) NOT NULL DEFAULT 'EG',
  base_currency   CHAR(3) NOT NULL DEFAULT 'EGP',
  timezone        TEXT NOT NULL DEFAULT 'Africa/Cairo',
  locale          TEXT NOT NULL DEFAULT 'ar-EG',
  region          TEXT NOT NULL DEFAULT 'me-central',
  plan            TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','growth','scale','enterprise')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('trial','active','suspended','deleted')),
  settings        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid    TEXT NOT NULL UNIQUE,
  email           TEXT,
  phone_e164      TEXT,
  display_name    TEXT,
  language        TEXT NOT NULL DEFAULT 'ar' CHECK (language IN ('ar','en')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('owner','admin','ops_manager','agent','warehouse','finance','media_buyer')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','disabled')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE api_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  prefix          TEXT NOT NULL,              -- shown to the user, e.g. mz_live_ab12
  hash            TEXT NOT NULL UNIQUE,       -- sha256 of the full key
  scopes          TEXT[] NOT NULL DEFAULT '{}',
  last_used_at    TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────────────────── Connections (stores, couriers, channels) ─────────────────────────

CREATE TABLE connections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('store','courier','whatsapp','ads','payment','tax')),
  provider        TEXT NOT NULL,              -- shopify, easyorders, bosta, meta_whatsapp, meta_ads, paymob …
  external_account TEXT,                      -- shop domain, business id, ad account id
  display_name    TEXT,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','needs_attention','disconnected')),
  status_reason   TEXT,
  secret_ref      TEXT,                       -- pointer into secrets (encrypted blob id); never the secret itself
  config          JSONB NOT NULL DEFAULT '{}',
  learned         JSONB NOT NULL DEFAULT '{}', -- engine-learned status codes, city aliases, query variants
  country         CHAR(2),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider, external_account)
);

CREATE TABLE secrets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ciphertext      BYTEA NOT NULL,             -- AES-256-GCM, data key wrapped by Cloud KMS
  wrapped_key     BYTEA NOT NULL,
  key_version     TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_at      TIMESTAMPTZ
);

-- ───────────────────────── Catalog and stock (M4) ─────────────────────────

CREATE TABLE products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  title_ar        TEXT,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','draft','archived')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE variants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku             TEXT NOT NULL,
  barcode         TEXT,
  title           TEXT,
  price_minor     BIGINT NOT NULL DEFAULT 0,
  compare_at_minor BIGINT,
  cogs_minor      BIGINT NOT NULL DEFAULT 0,
  currency        CHAR(3) NOT NULL,
  weight_grams    INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, sku)
);

-- Link between a Mizan variant and the same item in a store (SKU mapping memory, M1).
CREATE TABLE external_variants (
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id   UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  external_id     TEXT NOT NULL,
  external_product_id TEXT,
  inventory_item_id TEXT,
  variant_id      UUID REFERENCES variants(id) ON DELETE SET NULL,
  field_owner     JSONB NOT NULL DEFAULT '{"price":"mizan","compareAtPrice":"mizan","inventory":"mizan"}',
  last_seen       JSONB,
  PRIMARY KEY (connection_id, external_id)
);

CREATE TABLE warehouses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  city            TEXT,
  is_default      BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE stock_levels (
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  warehouse_id    UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  variant_id      UUID NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  on_hand         INT NOT NULL DEFAULT 0,
  reserved        INT NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  available       INT GENERATED ALWAYS AS (on_hand - reserved) STORED,
  low_stock_at    INT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (warehouse_id, variant_id)
);

CREATE TABLE stock_movements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  warehouse_id    UUID NOT NULL REFERENCES warehouses(id),
  variant_id      UUID NOT NULL REFERENCES variants(id),
  delta           INT NOT NULL,
  reason          TEXT NOT NULL CHECK (reason IN ('receive','pick','return_restock','adjust','transfer_in','transfer_out','write_off','reserve','release')),
  ref_type        TEXT,
  ref_id          UUID,
  device_op_id    TEXT,                       -- offline scan id from the ops app; unique → exactly-once sync
  actor_id        UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, device_op_id)
);

-- ───────────────────────── Customers and orders (M1, M2) ─────────────────────────

CREATE TABLE customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT,
  phone_e164      TEXT,                       -- personal data: encrypted column in production (see docs/07)
  phone_hash      TEXT,                       -- HMAC(phone, tenant pepper) for lookups and dedupe
  email           TEXT,
  orders_count    INT NOT NULL DEFAULT 0,
  delivered_count INT NOT NULL DEFAULT 0,
  refused_count   INT NOT NULL DEFAULT 0,
  ltv_minor       BIGINT NOT NULL DEFAULT 0,
  whatsapp_opt_in BOOLEAN NOT NULL DEFAULT false,
  opt_in_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, phone_hash)
);

CREATE TABLE orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id   UUID REFERENCES connections(id),
  external_id     TEXT,
  number          TEXT NOT NULL,
  customer_id     UUID REFERENCES customers(id),
  status          TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','pending_confirmation','confirmed','cancelled','shipped','delivered','returned')),
  custom_status   TEXT,
  payment_mode    TEXT NOT NULL DEFAULT 'cod' CHECK (payment_mode IN ('cod','prepaid','partial','unknown')),
  currency        CHAR(3) NOT NULL,
  subtotal_minor  BIGINT NOT NULL DEFAULT 0,
  shipping_minor  BIGINT NOT NULL DEFAULT 0,
  discount_minor  BIGINT NOT NULL DEFAULT 0,
  total_minor     BIGINT NOT NULL,
  cod_minor       BIGINT NOT NULL DEFAULT 0,
  risk_score      SMALLINT CHECK (risk_score BETWEEN 0 AND 100),
  risk_reasons    JSONB,
  confirm_route   TEXT CHECK (confirm_route IN ('auto','bot','agent','hold')),
  assigned_to     UUID REFERENCES users(id),
  ship_name       TEXT,
  ship_phone      TEXT,
  ship_line1      TEXT,
  ship_line2      TEXT,
  ship_city       TEXT,
  ship_province   TEXT,
  ship_country    CHAR(2),
  ship_lat        DOUBLE PRECISION,
  ship_lng        DOUBLE PRECISION,
  utm             JSONB,                      -- source, medium, campaign, content, term
  click_ids       JSONB,                      -- fbclid, ttclid, gclid, sccid
  tags            TEXT[] NOT NULL DEFAULT '{}',
  duplicate_of    UUID REFERENCES orders(id),
  placed_at       TIMESTAMPTZ NOT NULL,
  confirmed_at    TIMESTAMPTZ,
  shipped_at      TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, connection_id, external_id)
);
CREATE INDEX orders_queue ON orders (tenant_id, status, placed_at DESC);
CREATE INDEX orders_customer ON orders (tenant_id, customer_id);

CREATE TABLE order_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  external_line_id TEXT,
  variant_id      UUID REFERENCES variants(id),
  sku             TEXT,
  title           TEXT NOT NULL,
  quantity        INT NOT NULL CHECK (quantity > 0),
  unit_price_minor BIGINT NOT NULL,
  unit_cost_minor BIGINT NOT NULL DEFAULT 0   -- COGS snapshot at order time
);

CREATE TABLE order_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
  from_status     TEXT,
  to_status       TEXT,
  actor_type      TEXT NOT NULL CHECK (actor_type IN ('user','system','automation','customer','courier')),
  actor_id        TEXT,
  data            JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX order_events_order ON order_events (order_id, created_at);

CREATE TABLE confirmations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL CHECK (channel IN ('auto','whatsapp','call','sms','voice_bot')),
  attempt         SMALLINT NOT NULL DEFAULT 1,
  agent_id        UUID REFERENCES users(id),
  script_id       UUID,
  script_variant  TEXT,
  outcome         TEXT CHECK (outcome IN ('confirmed','changed','cancelled','no_answer','wrong_number','callback','pending')),
  notes           TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ
);

-- ───────────────────────── Shipping (M3) ─────────────────────────

CREATE TABLE shipments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id        UUID NOT NULL REFERENCES orders(id),
  connection_id   UUID NOT NULL REFERENCES connections(id),
  provider        TEXT NOT NULL,
  tracking_number TEXT,
  external_id     TEXT,
  status          TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created','pickup_requested','picked_up','in_transit','out_for_delivery','failed_attempt','delivered','returning','returned','cancelled','lost','unknown')),
  status_raw      TEXT,
  status_at       TIMESTAMPTZ,
  needs_review    BOOLEAN NOT NULL DEFAULT false,
  cod_minor       BIGINT NOT NULL DEFAULT 0,
  currency        CHAR(3) NOT NULL,
  fee_shipping_minor BIGINT,                  -- from courier rate card or settlement
  fee_cod_minor   BIGINT,
  fee_return_minor BIGINT,
  is_return_leg   BOOLEAN NOT NULL DEFAULT false,
  label_url       TEXT,
  attempts        SMALLINT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connection_id, tracking_number)
);
CREATE INDEX shipments_active ON shipments (tenant_id, status) WHERE status NOT IN ('delivered','returned','cancelled','lost');

CREATE TABLE shipment_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  shipment_id     UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  status          TEXT NOT NULL,
  status_raw      TEXT,
  source          TEXT NOT NULL CHECK (source IN ('webhook','poll','ops')),
  occurred_at     TIMESTAMPTZ NOT NULL,
  data            JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────────────────── Returns and tickets (M6) ─────────────────────────

CREATE TABLE tickets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id        UUID REFERENCES orders(id),
  type            TEXT NOT NULL CHECK (type IN ('complaint','exchange','refund','delivery_issue','return')),
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','waiting_customer','waiting_courier','in_inspection','resolved','closed')),
  reason          TEXT,
  inspection      TEXT CHECK (inspection IN ('restock','damaged','write_off')),
  linked_order_id UUID REFERENCES orders(id),
  return_shipment_id UUID REFERENCES shipments(id),
  assigned_to     UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ
);

-- ───────────────────────── Profit (M5) and money ─────────────────────────

CREATE TABLE fx_rates (
  day             DATE NOT NULL,
  base            CHAR(3) NOT NULL,
  quote           CHAR(3) NOT NULL,
  rate            NUMERIC(18,8) NOT NULL,
  source          TEXT NOT NULL,
  PRIMARY KEY (day, base, quote)
);

CREATE TABLE cost_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('agent_per_order','packaging_per_order','payment_fee_pct','cod_fee_pct','fixed_monthly','courier_rate')),
  scope           JSONB NOT NULL DEFAULT '{}', -- e.g. {"courier":"bosta","zone":"cairo"}
  amount_minor    BIGINT,
  pct             NUMERIC(6,3),
  currency        CHAR(3),
  valid_from      DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_to        DATE
);

CREATE TABLE order_pnl (
  order_id        UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  currency        CHAR(3) NOT NULL,           -- tenant base currency
  revenue_minor   BIGINT NOT NULL DEFAULT 0,  -- 0 until delivered (COD) or paid (prepaid)
  cogs_minor      BIGINT NOT NULL DEFAULT 0,
  shipping_minor  BIGINT NOT NULL DEFAULT 0,
  cod_fee_minor   BIGINT NOT NULL DEFAULT 0,
  payment_fee_minor BIGINT NOT NULL DEFAULT 0,
  ads_minor       BIGINT NOT NULL DEFAULT 0,
  agent_minor     BIGINT NOT NULL DEFAULT 0,
  packaging_minor BIGINT NOT NULL DEFAULT 0,
  rto_minor       BIGINT NOT NULL DEFAULT 0,
  net_minor       BIGINT GENERATED ALWAYS AS (revenue_minor - cogs_minor - shipping_minor - cod_fee_minor - payment_fee_minor - ads_minor - agent_minor - packaging_minor - rto_minor) STORED,
  is_final        BOOLEAN NOT NULL DEFAULT false, -- true after delivered+settled or returned+inspected
  fx_day          DATE,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  version         INT NOT NULL DEFAULT 1
);
CREATE INDEX order_pnl_tenant ON order_pnl (tenant_id, computed_at);

-- ───────────────────────── Ads (M7) and cash (M8) — V2, created now to keep FKs simple ─────────────────────────

CREATE TABLE ad_spend (
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id   UUID NOT NULL REFERENCES connections(id),
  day             DATE NOT NULL,
  platform        TEXT NOT NULL,
  campaign_id     TEXT NOT NULL,
  adset_id        TEXT NOT NULL DEFAULT '',
  ad_id           TEXT NOT NULL DEFAULT '',
  campaign_name   TEXT,
  spend_minor     BIGINT NOT NULL,
  currency        CHAR(3) NOT NULL,
  impressions     BIGINT,
  clicks          BIGINT,
  PRIMARY KEY (connection_id, day, campaign_id, adset_id, ad_id)
);

CREATE TABLE settlements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id   UUID NOT NULL REFERENCES connections(id),
  period_start    DATE,
  period_end      DATE,
  reference       TEXT,
  amount_minor    BIGINT NOT NULL,
  currency        CHAR(3) NOT NULL,
  source          TEXT NOT NULL CHECK (source IN ('api','file')),
  file_id         TEXT,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE settlement_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  settlement_id   UUID NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  shipment_id     UUID REFERENCES shipments(id),
  tracking_number TEXT,
  expected_minor  BIGINT,
  paid_minor      BIGINT NOT NULL,
  fees_minor      BIGINT NOT NULL DEFAULT 0,
  match_status    TEXT NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('matched','short','over','unmatched','disputed'))
);

-- ───────────────────────── Automation (M13) and scripts (M14) ─────────────────────────

CREATE TABLE scripts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  purpose         TEXT NOT NULL CHECK (purpose IN ('confirmation','delivery_followup','return','campaign','agent_call')),
  dialect         TEXT NOT NULL DEFAULT 'eg' CHECK (dialect IN ('eg','gulf','darija','levant','iraq','msa','en','fr')),
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  version         INT NOT NULL DEFAULT 1,
  blocks          JSONB NOT NULL,             -- ordered blocks, branches, variables
  wa_template_names JSONB,                    -- approved WhatsApp template per block, per language
  ab_test         JSONB,                      -- {variants:[…], split:[50,50], metric:'delivered_rate'}
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at    TIMESTAMPTZ
);

CREATE TABLE automations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  recipe          TEXT,                       -- built-in recipe key, null for custom
  trigger_event   TEXT NOT NULL,              -- e.g. order.created
  conditions      JSONB NOT NULL DEFAULT '[]',
  actions         JSONB NOT NULL DEFAULT '[]',
  enabled         BOOLEAN NOT NULL DEFAULT false,
  version         INT NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE automation_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  automation_id   UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  event_id        UUID NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('skipped','succeeded','failed')),
  log             JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (automation_id, event_id)            -- one run per event
);

-- ───────────────────────── Platform: events, outbox, audit, compliance ─────────────────────────

CREATE TABLE domain_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_id       UUID NOT NULL,
  actor           JSONB,
  data            JSONB NOT NULL DEFAULT '{}',
  version         SMALLINT NOT NULL DEFAULT 1,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  dispatched_at   TIMESTAMPTZ
);
CREATE INDEX domain_events_undispatched ON domain_events (occurred_at) WHERE dispatched_at IS NULL;

CREATE TABLE audit_log (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       UUID REFERENCES tenants(id),
  actor_id        UUID,
  actor_type      TEXT NOT NULL,
  action          TEXT NOT NULL,              -- e.g. connection.secret_rotated, customer.pii_viewed
  entity_type     TEXT,
  entity_id       TEXT,
  before          JSONB,
  after           JSONB,
  ip              INET,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE privacy_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source          TEXT NOT NULL CHECK (source IN ('shopify_customers_data_request','shopify_customers_redact','shopify_shop_redact','merchant','customer')),
  subject_ref     TEXT,                       -- phone hash or external customer id
  payload         JSONB,
  status          TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','in_progress','done','rejected')),
  due_at          TIMESTAMPTZ NOT NULL,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Engine tables (from packages/engine/src/sync/sql-store.ts), tenant-scoped.
CREATE TABLE mz_inbound_events (
  key             TEXT PRIMARY KEY,
  tenant_id       UUID,
  received_at     BIGINT NOT NULL
);

CREATE TABLE mz_outbox (
  id              UUID PRIMARY KEY,
  tenant_id       UUID,
  kind            TEXT NOT NULL,
  connection      TEXT NOT NULL,
  payload         JSONB NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL CHECK (status IN ('pending','running','done','dead')),
  attempts        INT NOT NULL DEFAULT 0,
  next_attempt_at BIGINT NOT NULL,
  locked_until    BIGINT,
  last_error      TEXT,
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL
);
CREATE INDEX mz_outbox_due ON mz_outbox (next_attempt_at) WHERE status IN ('pending','running');
CREATE INDEX mz_outbox_dead ON mz_outbox (updated_at) WHERE status = 'dead';

CREATE TABLE mz_records (
  type            TEXT NOT NULL,
  key             TEXT NOT NULL,
  tenant_id       UUID,
  value           JSONB NOT NULL,
  updated_at      BIGINT NOT NULL,
  PRIMARY KEY (type, key)
);

-- ───────────────────────── Row-level security ─────────────────────────
-- The app connects as role mizan_app (no BYPASSRLS, not table owner) and runs
--   SET LOCAL app.tenant_id = '<uuid>'
-- at the start of every transaction.

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'memberships','api_keys','connections','secrets','products','variants','external_variants','warehouses',
    'stock_levels','stock_movements','customers','orders','order_lines','order_events','confirmations',
    'shipments','shipment_events','tickets','cost_rules','order_pnl','ad_spend','settlements','settlement_lines',
    'scripts','automations','automation_runs','domain_events','privacy_requests'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;
