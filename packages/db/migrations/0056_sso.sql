-- A-9: company sign-in (SSO). Mizan staff route a store's verified email domain to its identity
-- provider, a SAML or OIDC provider in Firebase Identity Platform ("saml.acme", "oidc.acme").
-- Only staff write it: a store that could claim any domain could have its own identity provider
-- vouch for someone else's work email. Sign-in looks the domain up before anyone is signed in, so
-- the app role reads it with no tenant, and only which provider (never which store).
CREATE TABLE sso_domains (
  domain       TEXT PRIMARY KEY CHECK (domain = lower(domain) AND domain ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$' AND char_length(domain) <= 253),
  store_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider_id  TEXT NOT NULL CHECK (provider_id ~ '^(saml|oidc)\.[a-z0-9-]{1,60}$'),
  enabled      BOOLEAN NOT NULL DEFAULT true,
  staff_id     UUID REFERENCES platform_staff(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sso_domains_store ON sso_domains (store_id);
CREATE INDEX sso_domains_provider ON sso_domains (provider_id) WHERE enabled;

REVOKE ALL ON sso_domains FROM mizan_app, mizan_worker;
GRANT SELECT (domain, provider_id, enabled) ON sso_domains TO mizan_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sso_domains TO mizan_platform;
