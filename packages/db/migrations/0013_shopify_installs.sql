-- Shopify OAuth installs waiting to be claimed (E3-1).
--
-- The Shopify App Store requires OAuth to run immediately after "Install",
-- before the merchant has signed in to Mizan, so the callback cannot always
-- know the tenant. It exchanges the code, keeps the access token here sealed
-- (AES-256-GCM under a KMS-wrapped data key, AAD = install id), and hands the
-- browser a one-time claim token. A signed-in owner or admin then claims the
-- install into their store. Installs started inside Mizan are bound to the
-- user and tenant that started them and can only be claimed by them.
--
-- Pre-tenant rows, like users: no tenant_id until claimed. Only the worker
-- role (asWorker) touches the table; the app role has no access at all.
CREATE TABLE shopify_installs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop          TEXT NOT NULL,                 -- <name>.myshopify.com, validated
  scopes        TEXT NOT NULL,                 -- as granted by Shopify
  ciphertext    BYTEA NOT NULL,
  wrapped_key   BYTEA NOT NULL,
  key_version   TEXT NOT NULL,
  claim_hash    BYTEA NOT NULL UNIQUE,         -- sha256 of the claim token; the token itself is never stored
  bound_tenant  UUID REFERENCES tenants(id) ON DELETE CASCADE,
  bound_user    UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  claimed_at    TIMESTAMPTZ,
  CHECK ((bound_tenant IS NULL) = (bound_user IS NULL))
);
CREATE INDEX shopify_installs_expires ON shopify_installs (expires_at);

ALTER TABLE shopify_installs ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopify_installs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON shopify_installs FROM mizan_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON shopify_installs TO mizan_worker;
CREATE POLICY worker_installs ON shopify_installs FOR ALL TO mizan_worker USING (true) WITH CHECK (true);

-- One Shopify store belongs to one Mizan account: the claim checks across tenants
-- that no other tenant holds the shop, and GDPR webhooks (E3-3) route by shop domain.
-- The shop domain is not a secret; credentials, config and learned data stay hidden.
GRANT SELECT (external_account) ON connections TO mizan_worker;
CREATE INDEX connections_provider_account ON connections (provider, external_account) WHERE external_account IS NOT NULL;
