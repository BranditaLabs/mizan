-- M7-3: campaign results down to the ad set and the ad. A spend export (Meta, TikTok, Snap, Google)
-- names the campaign, ad set (TikTok: ad group) and ad; the ids stay in campaign_id, adset_id and
-- ad_id (the name when the export has no id), the names here. Orders match them by their UTM tags.
ALTER TABLE ad_spend ADD COLUMN adset_name TEXT CHECK (char_length(adset_name) <= 200);
ALTER TABLE ad_spend ADD COLUMN ad_name TEXT CHECK (char_length(ad_name) <= 200);
