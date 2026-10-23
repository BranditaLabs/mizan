-- E9-3: ad spend entered by hand or imported from CSV, per store and day, before the ad
-- platforms' APIs (M7). One row per store connection, day, platform and campaign (empty for a
-- day's total). The profit service spreads a day's spend over the orders that store took that
-- day (docs/04 §5).
ALTER TABLE ad_spend DROP CONSTRAINT IF EXISTS ad_spend_pkey;
ALTER TABLE ad_spend ADD PRIMARY KEY (connection_id, day, platform, campaign_id, adset_id, ad_id);
ALTER TABLE ad_spend ADD COLUMN source TEXT NOT NULL DEFAULT 'api' CHECK (source IN ('manual','csv','api'));
ALTER TABLE ad_spend ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE ad_spend ADD COLUMN updated_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE ad_spend ADD CONSTRAINT ad_spend_shape CHECK (spend_minor >= 0 AND platform ~ '^[a-z][a-z_]{1,19}$');
CREATE INDEX ad_spend_day ON ad_spend (tenant_id, day);
