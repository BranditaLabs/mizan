-- Mizan migration 0002: full commerce OS.
-- Adds every payment method (M15), payout reconciliation for all sources (M8), purchasing (M16),
-- customer service inbox (M17), sales channels and marketplaces (M18), finance (M19),
-- reports (M20), webhooks out (M21) and POS (M22).

-- ───────────── Orders: channel and payment state for every method ─────────────

ALTER TABLE orders DROP CONSTRAINT orders_payment_mode_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_mode_check
  CHECK (payment_mode IN ('cod','prepaid','partial','bnpl','bank_transfer','store_credit','mixed','unknown'));
ALTER TABLE orders
  ADD COLUMN channel        TEXT NOT NULL DEFAULT 'store' CHECK (channel IN ('store','marketplace','social','chat','manual','pos','b2b')),
  ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','authorized','partially_paid','paid','partially_refunded','refunded','disputed','failed','voided')),
  ADD COLUMN paid_minor     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN refunded_minor BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN balance_minor  BIGINT GENERATED ALWAYS AS (GREATEST(total_minor - paid_minor, 0)) STORED,  -- still owed by the customer (COD due, deposit balance)
  ADD COLUMN location_id    UUID REFERENCES warehouses(id);

ALTER TABLE connections DROP CONSTRAINT connections_kind_check;
ALTER TABLE connections ADD CONSTRAINT connections_kind_check
  CHECK (kind IN ('store','marketplace','courier','whatsapp','messaging','ads','payment','bnpl','bank','accounting','tax','email','sms'));

ALTER TABLE warehouses
  ADD COLUMN type TEXT NOT NULL DEFAULT 'warehouse' CHECK (type IN ('warehouse','shop','marketplace_fc','supplier_dropship'));

-- ───────────── M15 Payments and refunds ─────────────

CREATE TABLE payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  connection_id   UUID REFERENCES connections(id),          -- gateway / BNPL / bank; null for cash
  method          TEXT NOT NULL CHECK (method IN ('cod','card','wallet','apple_pay','bnpl','bank_transfer','instapay','fawry_ref','store_credit','cash_pos','marketplace')),
  kind            TEXT NOT NULL CHECK (kind IN ('authorization','capture','sale','cod_collection','refund','chargeback','chargeback_reversal','void')),
  status          TEXT NOT NULL CHECK (status IN ('pending','succeeded','failed','cancelled')),
  amount_minor    BIGINT NOT NULL,                          -- positive = money in, negative = money out
  currency        CHAR(3) NOT NULL,
  fee_minor       BIGINT,                                   -- estimated until payout matched
  fee_is_actual   BOOLEAN NOT NULL DEFAULT false,
  external_ref    TEXT,                                     -- gateway transaction id
  parent_id       UUID REFERENCES payments(id),             -- refund/capture → original
  failure_reason  TEXT,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connection_id, external_ref, kind)
);
CREATE INDEX payments_order ON payments (order_id, occurred_at);

CREATE TABLE payment_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  connection_id   UUID NOT NULL REFERENCES connections(id),
  purpose         TEXT NOT NULL CHECK (purpose IN ('full','deposit','balance','convert_cod')),
  amount_minor    BIGINT NOT NULL,
  currency        CHAR(3) NOT NULL,
  discount_pct    NUMERIC(5,2),
  url             TEXT,
  external_ref    TEXT,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','expired','cancelled')),
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE refunds (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  ticket_id       UUID REFERENCES tickets(id),
  payment_id      UUID REFERENCES payments(id),             -- original payment refunded against
  destination     TEXT NOT NULL CHECK (destination IN ('original_method','store_credit','bank_transfer','cash')),
  amount_minor    BIGINT NOT NULL CHECK (amount_minor > 0),
  currency        CHAR(3) NOT NULL,
  reason          TEXT,
  status          TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','sent','completed','failed','rejected')),
  approved_by     UUID REFERENCES users(id),
  external_ref    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

CREATE TABLE disputes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id        UUID NOT NULL REFERENCES orders(id),
  payment_id      UUID REFERENCES payments(id),
  amount_minor    BIGINT NOT NULL,
  fee_minor       BIGINT NOT NULL DEFAULT 0,
  currency        CHAR(3) NOT NULL,
  reason_code     TEXT,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','evidence_submitted','won','lost','accepted')),
  evidence        JSONB,
  respond_by      TIMESTAMPTZ,
  external_ref    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at       TIMESTAMPTZ
);

CREATE TABLE store_credit_ledger (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id     UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  delta_minor     BIGINT NOT NULL,
  currency        CHAR(3) NOT NULL,
  reason          TEXT NOT NULL CHECK (reason IN ('refund','loyalty','goodwill','redeemed','expired','adjustment')),
  ref_id          UUID,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────── M8 Reconciliation for every payout source ─────────────

ALTER TABLE settlements
  ADD COLUMN source_type TEXT NOT NULL DEFAULT 'courier' CHECK (source_type IN ('courier','gateway','bnpl','bank','marketplace')),
  ADD COLUMN fees_minor  BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN refunds_minor BIGINT NOT NULL DEFAULT 0;

ALTER TABLE settlement_lines
  ADD COLUMN payment_id   UUID REFERENCES payments(id),
  ADD COLUMN order_id     UUID REFERENCES orders(id),
  ADD COLUMN external_ref TEXT,
  ADD COLUMN line_kind    TEXT NOT NULL DEFAULT 'sale' CHECK (line_kind IN ('sale','cod_collection','refund','chargeback','fee','reserve','adjustment'));

-- ───────────── M5 Profit: method-specific costs ─────────────

ALTER TABLE order_pnl DROP COLUMN net_minor;
ALTER TABLE order_pnl
  ADD COLUMN refund_minor          BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN chargeback_minor      BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN channel_fee_minor     BIGINT NOT NULL DEFAULT 0,   -- marketplace commission, fulfilment
  ADD COLUMN net_minor BIGINT GENERATED ALWAYS AS (
    revenue_minor - refund_minor - cogs_minor - shipping_minor - cod_fee_minor - payment_fee_minor
    - channel_fee_minor - ads_minor - agent_minor - packaging_minor - rto_minor - chargeback_minor) STORED;

-- ───────────── M16 Purchasing and suppliers ─────────────

CREATE TABLE suppliers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  contact_name    TEXT,
  phone_e164      TEXT,
  email           TEXT,
  country         CHAR(2),
  currency        CHAR(3) NOT NULL,
  lead_time_days  INT,
  payment_terms   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE purchase_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  supplier_id     UUID NOT NULL REFERENCES suppliers(id),
  warehouse_id    UUID NOT NULL REFERENCES warehouses(id),
  number          TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','sent','partially_received','received','billed','cancelled')),
  currency        CHAR(3) NOT NULL,
  total_minor     BIGINT NOT NULL DEFAULT 0,
  expected_at     DATE,
  approved_by     UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, number)
);

CREATE TABLE purchase_order_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  variant_id      UUID NOT NULL REFERENCES variants(id),
  quantity        INT NOT NULL CHECK (quantity > 0),
  received_qty    INT NOT NULL DEFAULT 0,
  unit_cost_minor BIGINT NOT NULL,
  landed_cost_minor BIGINT                                   -- per unit, base currency, after allocation
);

CREATE TABLE landed_costs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('freight','customs','insurance','clearance','other')),
  amount_minor    BIGINT NOT NULL,
  currency        CHAR(3) NOT NULL,
  allocate_by     TEXT NOT NULL DEFAULT 'value' CHECK (allocate_by IN ('value','quantity','weight'))
);

-- ───────────── M17 Customer service inbox ─────────────

CREATE TABLE conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id   UUID REFERENCES connections(id),
  channel         TEXT NOT NULL CHECK (channel IN ('whatsapp','instagram','messenger','email','webchat','sms','phone')),
  external_thread TEXT,
  customer_id     UUID REFERENCES customers(id),
  order_id        UUID REFERENCES orders(id),
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','waiting_customer','resolved','closed')),
  topic           TEXT,
  assigned_to     UUID REFERENCES users(id),
  first_response_at TIMESTAMPTZ,
  sla_due_at      TIMESTAMPTZ,
  csat            SMALLINT CHECK (csat BETWEEN 1 AND 5),
  last_message_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connection_id, external_thread)
);
CREATE INDEX conversations_queue ON conversations (tenant_id, status, sla_due_at);

CREATE TABLE messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction       TEXT NOT NULL CHECK (direction IN ('in','out')),
  sender_type     TEXT NOT NULL CHECK (sender_type IN ('customer','agent','bot','automation','system')),
  sender_id       TEXT,
  body            TEXT,
  attachments     JSONB,
  template_name   TEXT,
  external_id     TEXT,
  status          TEXT CHECK (status IN ('queued','sent','delivered','read','failed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX messages_conversation ON messages (conversation_id, created_at);

-- ───────────── M18 Sales channels and marketplaces ─────────────

CREATE TABLE listings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id   UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  variant_id      UUID NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  external_id     TEXT,                                     -- ASIN, Noon SKU, Jumia SKU
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','active','paused','error')),
  price_minor     BIGINT,
  stock_buffer    INT NOT NULL DEFAULT 2,
  last_error      TEXT,
  synced_at       TIMESTAMPTZ,
  UNIQUE (connection_id, variant_id)
);

-- ───────────── M19 Finance ─────────────

CREATE TABLE expenses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category        TEXT NOT NULL,                            -- salaries, rent, tools, marketing_other …
  description     TEXT,
  amount_minor    BIGINT NOT NULL,
  currency        CHAR(3) NOT NULL,
  incurred_on     DATE NOT NULL,
  recurring       TEXT CHECK (recurring IN ('monthly','yearly')),
  supplier_id     UUID REFERENCES suppliers(id),
  receipt_file    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE accounting_periods (
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period          DATE NOT NULL,                            -- first day of month
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  closed_by       UUID REFERENCES users(id),
  closed_at       TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, period)
);

CREATE TABLE tax_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id        UUID REFERENCES orders(id),
  authority       TEXT NOT NULL CHECK (authority IN ('zatca','eta','fta')),
  kind            TEXT NOT NULL CHECK (kind IN ('standard_invoice','simplified_invoice','credit_note','e_receipt')),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','cleared','reported','rejected')),
  uuid_ref        TEXT,
  response        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────── M20 Reports, M21 webhooks out, M22 POS ─────────────

CREATE TABLE reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  definition      JSONB NOT NULL,                           -- dataset, metrics, dimensions, filters, chart
  visibility      TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','team','tenant')),
  schedule        JSONB,                                    -- cron, channel, recipients
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE webhook_subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  url             TEXT NOT NULL,
  events          TEXT[] NOT NULL,
  secret_ref      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE webhook_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
  event_id        UUID NOT NULL,
  attempt         SMALLINT NOT NULL DEFAULT 1,
  status_code     INT,
  succeeded       BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, event_id, attempt)
);

CREATE TABLE pos_shifts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id     UUID NOT NULL REFERENCES warehouses(id),
  register        TEXT NOT NULL,
  opened_by       UUID NOT NULL REFERENCES users(id),
  opening_float_minor BIGINT NOT NULL DEFAULT 0,
  expected_cash_minor BIGINT,
  counted_cash_minor  BIGINT,
  variance_minor  BIGINT GENERATED ALWAYS AS (counted_cash_minor - expected_cash_minor) STORED,
  opened_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at       TIMESTAMPTZ
);

-- ───────────── RLS for the new tables ─────────────

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'payments','payment_links','refunds','disputes','store_credit_ledger','suppliers','purchase_orders',
    'purchase_order_lines','landed_costs','conversations','messages','listings','expenses','accounting_periods',
    'tax_documents','reports','webhook_subscriptions','webhook_deliveries','pos_shifts'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;
