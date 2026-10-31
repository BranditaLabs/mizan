-- E6-10 confirmation inside WhatsApp, with team or automatic calls. The customer answers by
-- tapping buttons in the chat (no link to open); the store's team calls whoever does not answer.

-- Channels: whatsapp, call_team (the store's own team), call_auto (an automated call). SMS is no
-- longer offered; old rows keep their values. 'reply' steps are follow-up messages in the chat
-- (after a tap), queued like every other send (the module's outbox).
ALTER TABLE confirmation_steps DROP CONSTRAINT IF EXISTS confirmation_steps_channel_check;
ALTER TABLE confirmation_steps ADD CONSTRAINT confirmation_steps_channel_check
  CHECK (channel IN ('whatsapp','sms','voice','agent','call_team','call_auto'));
ALTER TABLE confirmation_steps DROP CONSTRAINT IF EXISTS confirmation_steps_kind_check;
ALTER TABLE confirmation_steps ADD CONSTRAINT confirmation_steps_kind_check CHECK (kind IN ('send','timeout','reply'));
-- What a reply step sends ({"message":"confirmed"}); never personal data.
ALTER TABLE confirmation_steps ADD COLUMN payload JSONB;

ALTER TABLE confirmation_runs
  -- What the chat waits for after a tap: the change the customer types, or a cancel reason.
  ADD COLUMN chat_state    TEXT CHECK (chat_state IN ('awaiting_change','awaiting_reason')),
  -- HMAC of the customer's number (tenant pepper): finds the run a typed message belongs to.
  ADD COLUMN customer_hash TEXT,
  -- Team calls: how many times the team tried, and when to show the order again after "no answer".
  ADD COLUMN call_attempts SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN call_after    TIMESTAMPTZ;
CREATE INDEX confirmation_runs_customer ON confirmation_runs (tenant_id, customer_hash, started_at DESC) WHERE customer_hash IS NOT NULL;
CREATE INDEX confirmation_runs_needs_call ON confirmation_runs (tenant_id, call_after) WHERE status = 'needs_agent';

-- The WhatsApp conversation: every message sent and received, its delivery status, and what a
-- tap meant. Message text is never stored here (a typed change goes to confirmations.notes,
-- encrypted). wamid is Meta's message id: a redelivered webhook finds its row and changes nothing.
CREATE TABLE whatsapp_messages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id  UUID REFERENCES connections(id) ON DELETE SET NULL,
  run_id         UUID REFERENCES confirmation_runs(id) ON DELETE SET NULL,
  order_id       UUID REFERENCES orders(id) ON DELETE CASCADE,
  direction      TEXT NOT NULL CHECK (direction IN ('in','out')),
  wamid          TEXT NOT NULL,
  -- out: template, buttons, list, text; in: quick_reply, button_reply, list_reply, text, location, other
  kind           TEXT NOT NULL,
  -- What it means for the order: confirm, change, cancel, keep, reason, note, ignored … (out: the message name)
  action         TEXT,
  status         TEXT NOT NULL CHECK (status IN ('accepted','sent','delivered','read','failed','received')),
  error_code     INT,
  -- The step that sent it (our key, echoed by Meta): verifies a send whose response was lost.
  step_key       TEXT,
  customer_hash  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, wamid)
);
CREATE INDEX whatsapp_messages_run ON whatsapp_messages (tenant_id, run_id, created_at);
CREATE INDEX whatsapp_messages_step ON whatsapp_messages (tenant_id, step_key) WHERE step_key IS NOT NULL;
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON whatsapp_messages
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Meta posts every number's webhooks to one URL: the worker finds the store by the number's id
-- (connections.external_account for provider whatsapp_cloud), and checks waiting connections.
GRANT SELECT (external_account, kind) ON connections TO mizan_worker;
CREATE INDEX connections_whatsapp_number ON connections (external_account) WHERE provider = 'whatsapp_cloud';

-- Attempts log: a call by the store's team.
ALTER TABLE confirmations DROP CONSTRAINT IF EXISTS confirmations_channel_check;
ALTER TABLE confirmations ADD CONSTRAINT confirmations_channel_check
  CHECK (channel IN ('auto','whatsapp','call','sms','voice_bot','link','voice_ivr','voice_ai','agent','call_team'));
