-- Owner confirmed on 2026-09-16 that these were refunded production tests.
-- Reporting classification only: preserve original receipts and refund facts.
-- Never infer a refund date or classify future pickle orders as tests.
CREATE TABLE IF NOT EXISTS order_reporting_exclusions (
  order_id TEXT PRIMARY KEY REFERENCES orders(id),
  reason TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO order_reporting_exclusions (order_id, reason, recorded_by)
SELECT id, 'Owner confirmed this was a dummy production order that was refunded; excluded from customer sales and tax reports.',
  'owner_confirmation_2026-09-16'
FROM orders
WHERE (id = '6be4aa8c-20e2-43b2-a2bb-d4fc569ba824' AND order_number = 'AJ-1005'
    AND ROUND(tax * 100) = 248 AND ROUND(total_price * 100) = 3248)
  OR (id = 'fcb6a2cf-df9a-4899-bb09-11e656c1829b' AND order_number = 'AJ-1006'
    AND ROUND(tax * 100) = 677 AND ROUND(total_price * 100) = 8877)
ON CONFLICT(order_id) DO NOTHING;
