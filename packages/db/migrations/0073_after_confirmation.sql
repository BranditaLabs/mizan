-- E6-23a: what happens after confirmation. A confirmed order can be held for a while (the grace
-- window, or because the customer wrote after confirming), and the follow-ups that act later
-- (release and book, cancel when nobody answered) wait in their own small queue. Ids, codes and
-- times only: no personal data.

ALTER TABLE orders
  ADD COLUMN held_until  TIMESTAMPTZ,
  ADD COLUMN hold_reason TEXT CHECK (hold_reason IN ('grace','customer_message')),
  ADD CONSTRAINT orders_hold_complete CHECK ((held_until IS NULL) = (hold_reason IS NULL));
CREATE INDEX orders_held ON orders (tenant_id, held_until) WHERE held_until IS NOT NULL;

CREATE TABLE order_followups (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id         UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  -- Null for the trusted route (confirmed without asking) and a confirmation without a run.
  run_id           UUID REFERENCES confirmation_runs(id) ON DELETE SET NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('release','no_answer_cancel')),
  channel          TEXT,
  changed          BOOLEAN NOT NULL DEFAULT false,
  auto_book        BOOLEAN NOT NULL DEFAULT false,
  run_at           TIMESTAMPTZ NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','skipped','blocked','dead')),
  attempts         SMALLINT NOT NULL DEFAULT 0,
  deferrals        SMALLINT NOT NULL DEFAULT 0,
  result           TEXT,
  idempotency_key  TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX order_followups_due ON order_followups (run_at) WHERE status = 'pending';
CREATE INDEX order_followups_order ON order_followups (tenant_id, order_id);

ALTER TABLE order_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_followups FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON order_followups
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- The worker only finds which stores have follow-ups due (then works inside each store's context).
GRANT SELECT (tenant_id, run_at, status) ON order_followups TO mizan_worker;
CREATE POLICY worker_find_due ON order_followups FOR SELECT TO mizan_worker USING (true);
