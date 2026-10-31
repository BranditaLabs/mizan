-- E14-1: the payment ledger (M15, docs/12 §3). Every line says where it came from: the store's
-- running totals (`store`), a gateway or BNPL transaction (`gateway`, E14-2), the courier's cash
-- (`courier`, M8) or the team (`manual`: a bank transfer, InstaPay or cash they received).
-- orders.paid_minor and refunded_minor are the sums of these lines, kept in the same transaction.
ALTER TABLE payments
  ADD COLUMN source      TEXT NOT NULL DEFAULT 'store' CHECK (source IN ('store','gateway','courier','manual')),
  ADD COLUMN note        TEXT CHECK (length(note) <= 300),
  ADD COLUMN recorded_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE payments ALTER COLUMN source DROP DEFAULT;

-- Signed by kind: money in is positive, money out negative, an authorization holds a positive amount.
ALTER TABLE payments ADD CONSTRAINT payments_sign CHECK (
  amount_minor <> 0 AND CASE
    WHEN kind IN ('authorization','capture','sale','cod_collection','chargeback_reversal') THEN amount_minor > 0
    ELSE amount_minor < 0 END
);

-- One line per reference. The old key let lines without a connection (manual orders, the team's
-- entries) repeat, since NULLs never collide; this one counts a missing connection as one value.
ALTER TABLE payments DROP CONSTRAINT payments_connection_id_external_ref_kind_key;
CREATE UNIQUE INDEX payments_ref ON payments (tenant_id, kind, external_ref, connection_id) NULLS NOT DISTINCT
  WHERE external_ref IS NOT NULL;
