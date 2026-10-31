-- Table hygiene and hot-path indexes (H-7).

-- Missing indexes found by reviewing every hot query:
-- /me and the member_self_read policy filter memberships by user (PK starts with tenant_id).
CREATE INDEX memberships_user ON memberships (user_id);
-- The order projector syncs lines by order.
CREATE INDEX order_lines_order ON order_lines (order_id);
-- Each tenant's engine claims its due jobs (tenant first, then due time).
CREATE INDEX mz_outbox_tenant_due ON mz_outbox (tenant_id, next_attempt_at) WHERE status IN ('pending','running');

-- Retention scans (batched deletes by the worker's maintenance loop).
CREATE INDEX mz_outbox_done ON mz_outbox (updated_at) WHERE status = 'done';
CREATE INDEX mz_inbound_events_received ON mz_inbound_events (received_at);
CREATE INDEX domain_events_dispatched ON domain_events (dispatched_at) WHERE dispatched_at IS NOT NULL;

-- The worker role prunes across tenants: finished jobs, old webhook keys,
-- dispatched events (their delivery marks cascade) and expired idempotency keys.
-- Never anything pending, running or dead.
GRANT DELETE ON mz_outbox, mz_inbound_events, domain_events, idempotency_keys TO mizan_worker;
GRANT SELECT (tenant_id, key, received_at) ON mz_inbound_events TO mizan_worker;
GRANT SELECT (actor_id, key, expires_at) ON idempotency_keys TO mizan_worker;
CREATE POLICY worker_prune ON mz_inbound_events FOR ALL TO mizan_worker USING (true);
CREATE POLICY worker_prune ON idempotency_keys FOR ALL TO mizan_worker USING (true);
