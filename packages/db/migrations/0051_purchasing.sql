-- M16-1: suppliers, purchase orders and receiving (the tables came with 0002; this adds what the
-- flow needs). A PO goes draft → approved → sent → partially_received → received (or cancelled
-- before anything arrived). Each receipt is a row with its lines: the good units go into stock
-- (a 'receive' movement referencing the PO), damaged ones are recorded but not stocked, and the
-- item's moving-average cost is updated at the FX rate of the receipt day, locked on the receipt.
-- A receipt from the ops app carries its opId: the same op is applied once.

ALTER TABLE suppliers
  ADD COLUMN notes        TEXT CHECK (length(notes) <= 500),
  ADD COLUMN archived_at  TIMESTAMPTZ,
  ADD COLUMN updated_at   TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE UNIQUE INDEX suppliers_name ON suppliers (tenant_id, lower(name)) WHERE archived_at IS NULL;

ALTER TABLE purchase_orders
  ADD COLUMN notes         TEXT CHECK (length(notes) <= 500),
  ADD COLUMN created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN approved_at   TIMESTAMPTZ,
  ADD COLUMN sent_at       TIMESTAMPTZ,
  ADD COLUMN received_at   TIMESTAMPTZ,
  ADD COLUMN cancelled_at  TIMESTAMPTZ,
  ADD COLUMN updated_at    TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE purchase_orders ALTER COLUMN approved_by DROP NOT NULL;
ALTER TABLE purchase_orders DROP CONSTRAINT purchase_orders_approved_by_fkey,
  ADD CONSTRAINT purchase_orders_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX purchase_orders_status ON purchase_orders (tenant_id, status, created_at DESC);
CREATE INDEX purchase_orders_supplier ON purchase_orders (tenant_id, supplier_id);

ALTER TABLE purchase_order_lines
  ADD COLUMN damaged_qty  INT NOT NULL DEFAULT 0 CHECK (damaged_qty >= 0),
  ADD CONSTRAINT purchase_order_lines_received CHECK (received_qty >= 0),
  ADD CONSTRAINT purchase_order_lines_cost CHECK (unit_cost_minor >= 0);
CREATE UNIQUE INDEX purchase_order_lines_variant ON purchase_order_lines (purchase_order_id, variant_id);

CREATE TABLE purchase_receipts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  number            INT NOT NULL,                              -- 1, 2 … per PO
  received_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  device_op_id      TEXT,                                      -- the ops app's opId: exactly once
  over_approved_by  UUID REFERENCES users(id) ON DELETE SET NULL, -- set when more than ordered was taken in
  fx_rate           NUMERIC(24,12),                            -- 1 item currency = rate PO currency, locked for this receipt
  fx_day            DATE,
  cost_status       TEXT NOT NULL CHECK (cost_status IN ('applied','fx_missing')),
  note              TEXT CHECK (length(note) <= 200),
  UNIQUE (purchase_order_id, number),
  UNIQUE (tenant_id, device_op_id)
);
CREATE INDEX purchase_receipts_po ON purchase_receipts (tenant_id, purchase_order_id);

CREATE TABLE purchase_receipt_lines (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  receipt_id         UUID NOT NULL REFERENCES purchase_receipts(id) ON DELETE CASCADE,
  po_line_id         UUID NOT NULL REFERENCES purchase_order_lines(id) ON DELETE CASCADE,
  variant_id         UUID NOT NULL REFERENCES variants(id),
  quantity           INT NOT NULL CHECK (quantity >= 0),      -- good units, into stock
  damaged            INT NOT NULL DEFAULT 0 CHECK (damaged >= 0),
  unit_cost_minor    BIGINT,                                   -- in the item's currency at fx_rate; null when fx_missing
  cost_before_minor  BIGINT,                                   -- the moving average before and after this receipt
  cost_after_minor   BIGINT,
  CHECK (quantity + damaged > 0)
);
CREATE INDEX purchase_receipt_lines_receipt ON purchase_receipt_lines (receipt_id);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['purchase_receipts','purchase_receipt_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;
