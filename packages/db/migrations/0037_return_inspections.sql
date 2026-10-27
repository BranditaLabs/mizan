-- E10-3: what came back, line by line (M6). Each inspection says how many units of an order line
-- came back sellable (restock: back into stock), damaged, or written off (their product cost is
-- lost on the order's profit). A line can be inspected in parts, never past its quantity (the
-- service checks it with the order locked). From the web or the ops app (device_op_id: once).
CREATE TABLE return_inspections (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id       UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_line_id  UUID NOT NULL REFERENCES order_lines(id) ON DELETE CASCADE,
  variant_id     UUID REFERENCES variants(id),
  ticket_id      UUID REFERENCES tickets(id),
  quantity       INT NOT NULL CHECK (quantity > 0),
  outcome        TEXT NOT NULL CHECK (outcome IN ('restock','damaged','write_off')),
  note           TEXT CHECK (length(note) <= 300),
  inspected_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  device_op_id   TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX return_inspections_order ON return_inspections (order_id);
CREATE INDEX return_inspections_recent ON return_inspections (tenant_id, created_at DESC);

ALTER TABLE return_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_inspections FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON return_inspections
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
