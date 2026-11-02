-- E14-3: COD to prepaid conversion. An offer asks the customer of a cash-on-delivery order to pay
-- the whole amount or a deposit before shipping (InstaPay, a wallet, a bank transfer, or a link
-- the store gives). It is a payment_links row with purpose 'convert_cod'; it is paid when the
-- ledger has received its amount since the offer, and the courier's cash drops with the ledger.
-- Gateway links (Paymob, E14-2) fill connection_id and url later; manual ones have neither.

ALTER TABLE payment_links ALTER COLUMN connection_id DROP NOT NULL;
ALTER TABLE payment_links
  ADD COLUMN kind              TEXT CHECK (kind IN ('full','deposit')),                -- a conversion: all of it, or a deposit
  ADD COLUMN method            TEXT CHECK (method IN ('instapay','wallet','bank_transfer','link','card')),
  ADD COLUMN instructions      TEXT CHECK (length(instructions) <= 300),   -- where to pay (the store's, never the customer's)
  ADD COLUMN paid_before_minor BIGINT NOT NULL DEFAULT 0,                   -- the order's paid total when offered
  ADD COLUMN paid_at           TIMESTAMPTZ,
  ADD COLUMN created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN source            TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','automation','gateway')),
  ADD CONSTRAINT payment_links_amount CHECK (amount_minor > 0);
CREATE UNIQUE INDEX payment_links_open_conversion ON payment_links (order_id) WHERE purpose = 'convert_cod' AND status = 'open';
CREATE INDEX payment_links_order ON payment_links (tenant_id, order_id, created_at DESC);
