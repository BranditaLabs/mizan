-- E7-3: the tracking list and the needs-review queue (M3). Shipments newest first per store, and
-- the ones a person must look at: a status the courier sent that Mizan could not map, or a booking
-- the courier refused (an unknown city, the address). Each status change is a shipment_events row
-- (webhook, poll, or ops when a person sets it).
CREATE INDEX shipments_recent ON shipments (tenant_id, created_at DESC, id DESC);
CREATE INDEX shipments_review ON shipments (tenant_id, created_at DESC) WHERE needs_review OR booking = 'failed';
CREATE INDEX shipment_events_shipment ON shipment_events (shipment_id, occurred_at DESC);
ALTER TABLE shipment_events ADD COLUMN actor_id UUID REFERENCES users(id) ON DELETE SET NULL;
