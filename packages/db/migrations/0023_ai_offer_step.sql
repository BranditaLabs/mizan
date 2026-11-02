-- E6-12: Claude picks and words the offer. The call runs as a confirmation step (the module's
-- outbox: claimed, called outside any transaction, recorded), never inside the run's start.
-- payload: the offer id and the candidates (product titles, prices, margin bands; no customer data).
ALTER TABLE confirmation_steps DROP CONSTRAINT IF EXISTS confirmation_steps_kind_check;
ALTER TABLE confirmation_steps ADD CONSTRAINT confirmation_steps_kind_check CHECK (kind IN ('send','timeout','reply','ai_offer'));
