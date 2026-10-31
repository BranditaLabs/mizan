-- E14-5: chargebacks (disputes) recorded by the team now, by the gateway with E14-2. Numbered per
-- store (D-1001…), one per gateway reference; the chargeback and a won dispute's reversal are lines
-- in the payments ledger. The evidence pack is built on read from the order, its shipments, chat
-- and payments; `evidence` keeps what was submitted (sections and the team's note), never PII.
ALTER TABLE disputes
  ADD COLUMN number                INT,
  ADD COLUMN source                TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','gateway')),
  ADD COLUMN note                  TEXT CHECK (length(note) <= 500),
  ADD COLUMN opened_by             UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN evidence_submitted_at TIMESTAMPTZ,
  ADD COLUMN reversal_payment_id   UUID REFERENCES payments(id),
  ADD COLUMN updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD CONSTRAINT disputes_amounts CHECK (amount_minor > 0 AND fee_minor >= 0),
  ADD CONSTRAINT disputes_reason CHECK (reason_code IS NULL OR reason_code IN ('fraud','not_received','not_as_described','duplicate','cancelled','other'));

UPDATE disputes d SET number = 1000 + n.rn
  FROM (SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY created_at, id) AS rn FROM disputes) n WHERE n.id = d.id;
ALTER TABLE disputes ALTER COLUMN number SET NOT NULL;

CREATE UNIQUE INDEX disputes_number ON disputes (tenant_id, number);
CREATE UNIQUE INDEX disputes_external ON disputes (tenant_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX disputes_order ON disputes (tenant_id, order_id);
CREATE INDEX disputes_due ON disputes (tenant_id, respond_by) WHERE status IN ('open','evidence_submitted');
