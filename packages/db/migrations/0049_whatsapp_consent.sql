-- E6-4b: WhatsApp consent (Meta's business messaging policy, docs/07). A customer who replies or taps
-- in the chat has opted in (source whatsapp_reply); one who writes STOP (or «إيقاف») has opted out,
-- and confirmation skips WhatsApp for them until they write START («ابدأ»). The opt-out is kept even
-- for a number that never ordered, so it holds when they do.
ALTER TABLE customers
  ADD COLUMN opt_in_source       TEXT CHECK (opt_in_source IN ('whatsapp_reply','checkout')),
  ADD COLUMN whatsapp_opt_out_at TIMESTAMPTZ,
  ADD CONSTRAINT customers_opt_out_not_in CHECK (whatsapp_opt_out_at IS NULL OR NOT whatsapp_opt_in);
