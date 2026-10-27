-- E7-2: bulk ship from the shipping screen — one more bulk action, booked per order by the worker
-- exactly as the order screen books one (one live shipment per order, cashToCollect).
ALTER TABLE bulk_actions DROP CONSTRAINT bulk_actions_action_check;
ALTER TABLE bulk_actions ADD CONSTRAINT bulk_actions_action_check CHECK (action IN ('assign','tag','confirm','cancel','ship'));
