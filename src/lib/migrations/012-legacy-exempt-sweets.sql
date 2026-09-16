-- Owner confirmed on 2026-09-16 that older orders were exempt baked sweets.
-- Only pre-existing zero-tax receipts with reconcilable item totals qualify.
-- Preserve original payments, order items and dates. Never infer refund dates.
INSERT INTO order_tax_records (
  order_id, session_id, paid_at, date_source, environment, destination_state, destination_city, destination_zip,
  merchandise_cents, taxable_merchandise_cents, exempt_merchandise_cents, shipping_cents, taxable_shipping_cents,
  tax_cents, total_cents, rate_basis_points, shipping_tax_rule, policy_version, review_reason, snapshot_json)
SELECT o.id, (SELECT f.payment_session_id FROM order_finalizations f WHERE f.order_id = o.id),
  o.created_at, 'historical_order_created_at', 'historical',
  CASE WHEN o.order_type = 'pickup' THEN 'TX'
    ELSE json_extract(s.fulfillment_data, '$.state') END,
  json_extract(s.fulfillment_data, '$.city'), json_extract(s.fulfillment_data, '$.zip'),
  i.merchandise, 0, i.merchandise, CAST(ROUND(o.total_price * 100) AS INTEGER) - i.merchandise, 0,
  0, CAST(ROUND(o.total_price * 100) AS INTEGER), 0, 'none', 'owner-confirmed-legacy-sweets-2026-09-16', NULL,
  json_object('version', 1, 'currency', 'USD', 'environment', 'historical',
    'policyVersion', 'owner-confirmed-legacy-sweets-2026-09-16', 'rateBasisPoints', 0,
    'shippingTaxRule', 'none', 'reviewReason', NULL,
    'destination', json_object('state', CASE WHEN o.order_type = 'pickup' THEN 'TX' ELSE json_extract(s.fulfillment_data, '$.state') END,
      'city', json_extract(s.fulfillment_data, '$.city'), 'zip', json_extract(s.fulfillment_data, '$.zip'), 'country', 'USA'),
    'merchandiseCents', i.merchandise, 'taxableMerchandiseCents', 0, 'exemptMerchandiseCents', i.merchandise,
    'shippingCents', CAST(ROUND(o.total_price * 100) AS INTEGER) - i.merchandise,
    'taxableShippingCents', 0, 'taxCents', 0, 'totalCents', CAST(ROUND(o.total_price * 100) AS INTEGER),
    'historicalSource', 'Owner confirmed exempt baked sweets; shipping reconciled from receipt total minus stored item totals.',
    'fulfillment', json_object('type', o.order_type, 'pickupLocation', o.pickup_location, 'deliveryAddress', o.delivery_address),
    'items', json(i.items))
FROM orders o
JOIN (SELECT order_id, SUM(CAST(ROUND(line_total * 100) AS INTEGER)) AS merchandise,
  json_group_array(json_object('productId', NULL, 'name', product_name, 'category', 'legacy-baked-sweets',
    'quantity', quantity, 'tier', selected_tier, 'variant', NULL,
    'lineCents', CAST(ROUND(line_total * 100) AS INTEGER), 'treatment', 'exempt',
    'classification', 'owner_confirmed_baked_sweets')) AS items
  FROM order_items GROUP BY order_id) i ON i.order_id = o.id
LEFT JOIN order_finalizations f ON f.order_id = o.id
LEFT JOIN payment_sessions s ON s.id = f.payment_session_id
WHERE o.created_at < '2026-09-16 12:31:37' AND o.payment_status IN ('paid', 'partially_refunded', 'refunded') AND o.tax = 0
  AND i.merchandise >= 0 AND i.merchandise <= CAST(ROUND(o.total_price * 100) AS INTEGER)
  AND NOT EXISTS (SELECT 1 FROM order_tax_records t WHERE t.order_id = o.id)
  AND NOT EXISTS (SELECT 1 FROM payment_tax_quotes q WHERE q.session_id = s.id);
