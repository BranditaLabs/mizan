-- Defence in depth for retention (H-7). The worker's policies on domain_events
-- (0006) and mz_outbox (0008) were FOR ALL USING (true); with DELETE granted in
-- 0011 a worker bug could delete live work. Split them per command: the worker
-- reads and updates everything it dispatches, but deletes only finished rows.

DROP POLICY dispatcher_all ON domain_events;
CREATE POLICY worker_read ON domain_events FOR SELECT TO mizan_worker USING (true);
CREATE POLICY worker_update ON domain_events FOR UPDATE TO mizan_worker USING (true) WITH CHECK (true);
CREATE POLICY worker_delete_dispatched ON domain_events FOR DELETE TO mizan_worker USING (dispatched_at IS NOT NULL);

DROP POLICY worker_claim ON mz_outbox;
CREATE POLICY worker_read ON mz_outbox FOR SELECT TO mizan_worker USING (true);
CREATE POLICY worker_update ON mz_outbox FOR UPDATE TO mizan_worker USING (true) WITH CHECK (true);
CREATE POLICY worker_delete_done ON mz_outbox FOR DELETE TO mizan_worker USING (status = 'done');
