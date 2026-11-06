-- Live updates (LV-1a, docs/16 §4.0). A browser's EventSource cannot send an Authorization header,
-- so GET /v1/live takes a short-lived token in its query string, minted by POST /v1/live/token.
-- Only the token's SHA-256 is stored; it is bound to one store, one person, their role and the
-- topics asked for, and it is used once (used_at). Any API replica can mint or accept it.

CREATE TABLE live_tokens (
  token_hash       BYTEA PRIMARY KEY,
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role             TEXT NOT NULL,
  -- Set when Mizan staff mint it through a support grant (A-3): the stream ends with the grant.
  support_grant_id UUID,
  topics           TEXT[] NOT NULL,
  expires_at       TIMESTAMPTZ NOT NULL,
  used_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX live_tokens_expiry ON live_tokens (tenant_id, expires_at);

ALTER TABLE live_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON live_tokens
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- The stream reads one store's recent events (under that store's RLS context) by time.
CREATE INDEX domain_events_tenant_recent ON domain_events (tenant_id, occurred_at);
