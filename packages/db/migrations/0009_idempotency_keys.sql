-- Idempotency-Key for side-effecting requests (H-4, docs/05). A key is scoped to
-- the caller and bound to a hash of method + path + store + body. Responses can
-- contain personal data: only the caller can read them back (RLS by app.user_id).
CREATE TABLE idempotency_keys (
  actor_id        UUID NOT NULL,
  key             TEXT NOT NULL CHECK (length(key) BETWEEN 1 AND 255),
  tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
  request_hash    TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('in_progress','done')),
  response_status SMALLINT,
  response_body   JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (actor_id, key)
);
CREATE INDEX idempotency_keys_expiry ON idempotency_keys (expires_at);

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY actor_only ON idempotency_keys
  USING (actor_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (actor_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
