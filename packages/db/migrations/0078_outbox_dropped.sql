-- FX-3a: no silent webhook losses. A disconnect no longer deletes a connection's waiting jobs:
-- they become `dropped`, with the reason in last_error, so support and the Event Center can see
-- what the disconnect stopped. The engine revives a dropped job when the same idempotency key is
-- enqueued again (a reconnect), and never moves a dropped job back to pending or dead on its own.
-- Ids, kinds and reasons only: no personal data.

ALTER TABLE mz_outbox DROP CONSTRAINT mz_outbox_status_check;
ALTER TABLE mz_outbox ADD CONSTRAINT mz_outbox_status_check
  CHECK (status IN ('pending','running','done','dead','dropped'));

-- The Event Center lists dropped jobs by time, like dead ones (mz_outbox_dead).
CREATE INDEX mz_outbox_dropped ON mz_outbox (updated_at) WHERE status = 'dropped';
