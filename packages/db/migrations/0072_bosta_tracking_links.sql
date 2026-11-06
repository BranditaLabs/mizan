-- Bosta deliveries booked while no tracking page was configured carry no link: Shopify's shipping
-- email and Mizan's order screen showed a bare number. Bosta's public tracking page is now the
-- default; the deliveries booked before it get their link here (Shopify's are put right by the
-- next fulfillment write).

UPDATE shipments
SET tracking_url = 'https://bosta.co/tracking-shipments?shipment-number=' || tracking_number
WHERE tracking_url IS NULL AND tracking_number IS NOT NULL AND provider = 'bosta';
