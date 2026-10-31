-- E14-4: refunds (M15). Requested → approved (at once under the store's threshold, otherwise by
-- owner, admin or finance, never by whoever asked unless the owner) or rejected → completed when
-- the money has gone back. Store credit completes on approval; money back through the store's own
-- checkout completes when the store reports it; a transfer or cash when the team records it.
-- Each completed refund is one refund line in the payments ledger (refund_payment_id).
ALTER TABLE refunds
  ADD COLUMN number            INT,
  ADD COLUMN requested_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN approved_at       TIMESTAMPTZ,
  ADD COLUMN rejected_at       TIMESTAMPTZ,
  ADD COLUMN rejection_reason  TEXT CHECK (length(rejection_reason) <= 300),
  ADD COLUMN note              TEXT CHECK (length(note) <= 300),
  ADD COLUMN refund_payment_id UUID REFERENCES payments(id),
  ADD COLUMN updated_at        TIMESTAMPTZ NOT NULL DEFAULT now();
UPDATE refunds r SET number = 1000 + n.rn
  FROM (SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY created_at, id) AS rn FROM refunds) n WHERE n.id = r.id;
ALTER TABLE refunds ALTER COLUMN number SET NOT NULL;
ALTER TABLE refunds ADD CONSTRAINT refunds_reason_length CHECK (length(reason) <= 300);
CREATE UNIQUE INDEX refunds_number ON refunds (tenant_id, number);
CREATE INDEX refunds_queue ON refunds (tenant_id, status, created_at DESC);
CREATE INDEX refunds_order ON refunds (order_id);

-- A refund on a ticket shows in the ticket's history.
ALTER TABLE ticket_events DROP CONSTRAINT ticket_events_type_check;
ALTER TABLE ticket_events ADD CONSTRAINT ticket_events_type_check CHECK (type IN ('created','status','assigned','updated','note','refund'));
-- One history line per refund step, however often its event is delivered.
ALTER TABLE ticket_events ADD COLUMN dedupe_key TEXT;
CREATE UNIQUE INDEX ticket_events_dedupe ON ticket_events (ticket_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
