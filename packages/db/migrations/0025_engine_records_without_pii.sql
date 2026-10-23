-- E2-8: the engine keeps orders in mz_records without personal data from now on (it needs ids,
-- money, statuses and the area). Scrub what was stored before: the customer, and of the address
-- everything but the city, province and country. Same shape as withoutPersonalData().
UPDATE mz_records SET value = jsonb_set(
    jsonb_set(value, '{order,customer}', '{"name": ""}'::jsonb),
    '{order,shippingAddress}',
    CASE WHEN jsonb_typeof(value->'order'->'shippingAddress') = 'object'
         THEN jsonb_strip_nulls(jsonb_build_object(
           'line1', '',
           'city', value->'order'->'shippingAddress'->'city',
           'province', value->'order'->'shippingAddress'->'province',
           'countryCode', value->'order'->'shippingAddress'->'countryCode'))
         ELSE 'null'::jsonb END)
WHERE type = 'order' AND jsonb_typeof(value->'order') = 'object';
