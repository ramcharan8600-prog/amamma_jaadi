-- Project Shippo: per-order shipping choices, one row per UPS label bought through
-- Shippo, and a sandbox-only self-test queue.

-- Owner's override of the automatic route ('shippo' or 'pirate_ship'); NULL = follow the rules.
ALTER TABLE orders ADD COLUMN ship_route TEXT CHECK (ship_route IN ('shippo', 'pirate_ship'));
-- Last box and packed weight (lb, box included) entered for the label, to re-quote.
ALTER TABLE orders ADD COLUMN ship_box TEXT;
ALTER TABLE orders ADD COLUMN ship_weight_lb REAL;
-- When the customer's tracking email was queued (sent exactly once).
ALTER TABLE orders ADD COLUMN tracking_emailed_at TEXT;

-- Orders already shipped or with a tracking number before this release never get
-- a tracking email (they were handled by hand).
UPDATE orders SET tracking_emailed_at = 'before-shippo'
WHERE order_type = 'delivery' AND (tracking_id IS NOT NULL OR shipment_status != 'yet_to_ship');

CREATE TABLE IF NOT EXISTS shipping_labels (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  -- buying: purchase sent, not yet confirmed (blocks a second purchase)
  status TEXT NOT NULL CHECK (status IN ('buying', 'purchased', 'voided', 'failed')),
  shippo_shipment_id TEXT,
  shippo_rate_id TEXT,
  shippo_transaction_id TEXT UNIQUE,
  provider TEXT,
  service_token TEXT,
  service_name TEXT,
  amount REAL,
  currency TEXT,
  box TEXT,
  weight_lb REAL,
  ship_date TEXT,
  tracking_number TEXT,
  tracking_url TEXT,
  label_url TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  purchased_at TEXT,
  voided_at TEXT,
  scanned_at TEXT
);
-- At most one label per order that is being bought or is usable.
CREATE UNIQUE INDEX IF NOT EXISTS idx_shipping_labels_one_active
  ON shipping_labels(order_id) WHERE status IN ('buying', 'purchased');
CREATE INDEX IF NOT EXISTS idx_shipping_labels_order ON shipping_labels(order_id, created_at);

-- Sandbox only: a row here asks the 15-minute job to exercise the Shippo test API
-- (address check, rates, test label, void) and store what came back.
CREATE TABLE IF NOT EXISTS shippo_self_tests (
  id TEXT PRIMARY KEY,
  order_id TEXT,
  -- label: quote + buy the recommended rate · void: void the order's label · track: tracking lookup check
  mode TEXT NOT NULL DEFAULT 'label' CHECK (mode IN ('label', 'void', 'track')),
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'done', 'failed')),
  result_json TEXT,
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  ran_at TEXT
);
