-- E5-1 orders list. What a list row may show of the customer, written with the order: the label
-- ("Mona A.", encrypted like the other personal fields) and the phone's last four digits (not
-- identifying alone). Redaction clears both.
ALTER TABLE orders
  ADD COLUMN customer_label TEXT,
  ADD COLUMN phone_last4    TEXT CHECK (phone_last4 ~ '^[0-9]{4}$');

-- Newest first with a stable tie-break (cursor pages), and order-number search.
CREATE INDEX orders_recent ON orders (tenant_id, placed_at DESC, id DESC);
CREATE INDEX orders_number ON orders (tenant_id, lower(number));
