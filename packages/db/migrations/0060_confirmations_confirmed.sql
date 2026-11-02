-- L1-7: the pilot dashboard's automation share reads, for each order of a period, whether it has a
-- confirmed attempt and by which channel. Confirmed attempts are few per order; index them.
CREATE INDEX confirmations_confirmed ON confirmations (order_id, channel) WHERE outcome = 'confirmed';
