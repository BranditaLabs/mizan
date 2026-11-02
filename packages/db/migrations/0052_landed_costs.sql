-- M16-4a: landed cost (freight, customs, insurance, clearance, fees) on a purchase order. Each
-- cost is spread over the PO's lines by value or by quantity; every receipt adds the share of the
-- units it takes in to their cost, converted to the item's currency at the receipt day's rate
-- (the same locked rate as the goods). A cost added after a receipt counts for later receipts only.

ALTER TABLE landed_costs
  ADD COLUMN description TEXT CHECK (length(description) <= 200),
  ADD COLUMN created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD CONSTRAINT landed_costs_amount CHECK (amount_minor > 0);
CREATE INDEX landed_costs_po ON landed_costs (tenant_id, purchase_order_id);

-- The landed cost these good units carried, in the item's currency (part of unit_cost_minor).
ALTER TABLE purchase_receipt_lines ADD COLUMN landed_minor BIGINT NOT NULL DEFAULT 0 CHECK (landed_minor >= 0);
