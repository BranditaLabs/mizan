-- Privacy requests from Shopify's compliance webhooks (E3-3) and, later, from merchants.
ALTER TABLE privacy_requests
  ADD COLUMN connection_id UUID REFERENCES connections(id) ON DELETE SET NULL,
  -- Provider event id: a redelivered webhook never creates a second request.
  ADD COLUMN dedupe_key    TEXT,
  -- customers/data_request: the compiled export, encrypted with the tenant's PII key ("pii:v1:…").
  ADD COLUMN result        TEXT,
  ADD COLUMN updated_at    TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE UNIQUE INDEX privacy_requests_dedupe ON privacy_requests (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX privacy_requests_open ON privacy_requests (tenant_id, due_at) WHERE status IN ('received', 'in_progress');

-- Redacted rows keep their business facts (totals, statuses, counts) and lose personal data
-- for good: the order projector must not write it back when the store sends the order again.
ALTER TABLE orders ADD COLUMN pii_redacted_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN redacted_at TIMESTAMPTZ;
