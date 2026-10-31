-- E7-1: booking a delivery with the courier (M3). The row exists from the moment the team asks to
-- ship (booking = pending, an outbox job carries it), and gets the tracking number once the courier
-- answers (booked) or why it refused (failed: an unknown city, the payment, the courier key).
-- One live outbound booking per order: a failed or cancelled one can be booked again.
ALTER TABLE shipments
  ADD COLUMN booking      TEXT NOT NULL DEFAULT 'booked' CHECK (booking IN ('pending','booked','failed')),
  ADD COLUMN error_code   TEXT,
  ADD COLUMN error        TEXT CHECK (length(error) <= 500),
  ADD COLUMN tracking_url TEXT,
  ADD COLUMN requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN booked_at    TIMESTAMPTZ;

CREATE UNIQUE INDEX shipments_one_live ON shipments (order_id)
  WHERE NOT is_return_leg AND booking <> 'failed' AND status <> 'cancelled';
