-- The first read of a store copy after 0070 only recorded a baseline, so a change already made in the
-- store was kept out of Mizan. The baselines recorded so far are dropped (the money Mizan sent is
-- kept): the next read takes each copy as it is now, and the guardian reads every copy without a
-- baseline at once.

UPDATE orders
SET store_copy_snapshot = jsonb_build_object('sentPaid', coalesce(store_copy_snapshot->>'sentPaid', '0'))
WHERE store_copy_id IS NOT NULL;
