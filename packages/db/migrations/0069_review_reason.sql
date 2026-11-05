-- Why a delivery waits for a person, kept apart from what the courier last said (status_raw): the
-- store cancelled the order after booking, the cash to collect changed, the parcel was shipped twice,
-- the courier refused a cancel. A courier update never clears it; a person's decision does.
-- And when the store cancelled an order the courier already had, so cancelling the delivery
-- cancels the order (instead of freeing it to ship again).

ALTER TABLE shipments ADD COLUMN review_reason TEXT CHECK (char_length(review_reason) <= 300);
ALTER TABLE orders ADD COLUMN store_cancelled_at TIMESTAMPTZ;
