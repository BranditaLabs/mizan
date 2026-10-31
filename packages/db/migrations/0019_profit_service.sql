-- E9-2 profit service. order_pnl holds realised profit (revenue counted when the money is real:
-- COD on delivery, prepaid on payment) and, for orders still moving, the profit expected if
-- they deliver; flags say which inputs are missing or estimated.
ALTER TABLE order_pnl
  ADD COLUMN day                    DATE,                                  -- the order's day, store time
  ADD COLUMN expected_revenue_minor BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN expected_net_minor     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN flags                  TEXT[] NOT NULL DEFAULT '{}';
CREATE INDEX order_pnl_day ON order_pnl (tenant_id, day);

-- unit_cost_minor defaults to 0, which can be a real cost: record when the cost was taken from
-- the product (on confirm), so a later price change never rewrites a confirmed order's profit.
ALTER TABLE order_lines ADD COLUMN cost_set_at TIMESTAMPTZ;
