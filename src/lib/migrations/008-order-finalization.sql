-- Apply before deploying atomic order finalization. This migration never sends
-- email and never adjusts inventory/coupon usage. Incomplete legacy receipts
-- are repaired only when that specific verified payment is replayed.
CREATE TABLE IF NOT EXISTS order_finalizations (
  order_id TEXT PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  payment_session_id TEXT UNIQUE NOT NULL REFERENCES payment_sessions(id),
  attempt_id TEXT UNIQUE NOT NULL,
  legacy_repair INTEGER NOT NULL DEFAULT 0 CHECK (legacy_repair IN (0, 1)),
  finalized_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Baseline complete historical receipts so a replay cannot resend old mail or
-- repeat inventory/coupon changes. Before the durable outbox was introduced,
-- successful email sends have no outbox row; treat those conservatively.
-- Missing item rows, receipt amount mismatch, unlinked sessions, and missing
-- post-outbox email intents are deliberately NOT marked finalized.
INSERT OR IGNORE INTO order_finalizations
  (order_id, payment_session_id, attempt_id, legacy_repair)
SELECT o.id, s.id, 'legacy-baseline:' || o.id, 1
FROM orders o JOIN payment_sessions s ON s.order_id = o.id
WHERE o.payment_status IN ('paid', 'partially_refunded', 'refunded')
  AND s.payment_status IN ('completed', 'partially_refunded', 'refunded')
  AND s.square_payment_id = o.square_payment_id
  AND (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id AND i.line_total > 0) > 0
  AND (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id AND i.line_total > 0)
      = json_array_length(CASE WHEN json_valid(s.cart_data) THEN s.cart_data ELSE '[]' END)
  AND ABS((SELECT COALESCE(SUM(i.line_total), 0) FROM order_items i WHERE i.order_id = o.id)
          + COALESCE(s.tax, 0) + COALESCE(s.shipping, 0) - s.total_amount) < 0.005
  AND (
    EXISTS (SELECT 1 FROM email_outbox e
            WHERE e.dedupe_key IN ('order-confirmation:' || o.order_number, 'owner-order-alert:' || o.order_number))
    OR o.created_at < COALESCE(
      (SELECT MIN(created_at) FROM email_outbox WHERE dedupe_key LIKE 'order-confirmation:%'),
      datetime('now')
    )
  );
