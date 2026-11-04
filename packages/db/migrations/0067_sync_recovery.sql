-- Sync guardian (two-way delivery, recovery): a job or an event that died of trouble that passes
-- (rate limits, timeouts, a provider down) is brought back automatically a few times, spaced out
-- (1 h, 6 h, 24 h after it died). The count caps it, so nothing loops forever; what still fails
-- stays dead for a person (Settings → Integrations, the back office).

ALTER TABLE mz_outbox ADD COLUMN revivals INT NOT NULL DEFAULT 0;
ALTER TABLE domain_events ADD COLUMN revivals INT NOT NULL DEFAULT 0;

-- The guardian's look for dead jobs and events to bring back.
CREATE INDEX mz_outbox_dead_revivable ON mz_outbox (updated_at) WHERE status = 'dead' AND revivals < 3;
CREATE INDEX domain_events_dead_revivable ON domain_events (dead_at) WHERE dead_at IS NOT NULL AND revivals < 3;
