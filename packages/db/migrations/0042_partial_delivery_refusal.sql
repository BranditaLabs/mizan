-- E10-4: what happened at the door (M6). A partial delivery: the customer kept some items and the
-- rest comes back; what they owe is now the kept items (plus shipping, less discount) — the ledger
-- measures paid against it, profit counts the cash collected. A refusal: the reason, and whether
-- they opened the box first (المعاينة), kept apart from plain RTO.
ALTER TABLE orders
  ADD COLUMN partial_items       JSONB,                 -- [{ lineId, quantity }] the customer kept
  ADD COLUMN partial_due_minor   BIGINT CHECK (partial_due_minor >= 0),
  ADD COLUMN partial_at          TIMESTAMPTZ,
  ADD COLUMN refusal_reason      TEXT,
  ADD COLUMN refusal_open_box    BOOLEAN,
  ADD COLUMN refused_at          TIMESTAMPTZ,
  ADD CONSTRAINT orders_partial_whole CHECK ((partial_items IS NULL) = (partial_due_minor IS NULL)),
  ADD CONSTRAINT orders_refusal_whole CHECK ((refusal_reason IS NULL) = (refused_at IS NULL));

-- What the customer still owes follows the partial delivery's amount due when there is one.
ALTER TABLE orders DROP COLUMN balance_minor;
ALTER TABLE orders ADD COLUMN balance_minor BIGINT GENERATED ALWAYS AS (GREATEST(COALESCE(partial_due_minor, total_minor) - paid_minor, 0)) STORED;
