-- E6-16d: the store owner chooses the confirmation's first message (a WhatsApp template) and
-- submits it to Meta from Mizan. Two small additions, no personal data:
--
-- whatsapp_messages.template: which template a first message was (ar_egyptian, ar_formal, ar_gulf,
--   en), so the run's transcript says what the customer received, fallback included.
-- connections.check_after: when the background check looks at a number again although it is no
--   longer pending (a template in Meta's review, or just submitted). The worker finds those
--   across stores, so it may read this column (a time only).

ALTER TABLE whatsapp_messages
  ADD COLUMN template TEXT CHECK (template IS NULL OR template IN ('ar_egyptian','ar_formal','ar_gulf','en'));

ALTER TABLE connections ADD COLUMN check_after TIMESTAMPTZ;
CREATE INDEX connections_check_after ON connections (check_after) WHERE check_after IS NOT NULL;
GRANT SELECT (check_after) ON connections TO mizan_worker;
