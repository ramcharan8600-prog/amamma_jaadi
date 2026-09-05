-- ============================================================
-- Amamma Jaadi — Cloudflare D1 (SQLite) schema
-- Apply with: wrangler d1 execute amammajaadi --remote --file=src/lib/d1-schema.sql
-- (or via the Cloudflare dashboard D1 console)
-- ============================================================

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_number TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  email TEXT,
  order_type TEXT NOT NULL,
  pickup_date TEXT,
  pickup_location TEXT,
  delivery_address TEXT,
  delivery_address_normalized TEXT,   -- JSON string
  shipping_method TEXT
    CHECK (shipping_method IN ('standard', 'ground', 'expedited')),
  total_price REAL NOT NULL,
  tax REAL DEFAULT 0,
  square_payment_id TEXT UNIQUE,       -- webhook idempotency: one order per payment
  status TEXT NOT NULL DEFAULT 'confirmed',
  payment_status TEXT NOT NULL DEFAULT 'pending',
  refunded_amount REAL NOT NULL DEFAULT 0,
  shipment_status TEXT NOT NULL DEFAULT 'yet_to_ship'
    CHECK (shipment_status IN ('yet_to_ship', 'shipped', 'delivered')),
  tracking_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  coupon_code TEXT,                         -- influencer coupon used (NULL if none)
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  product_price REAL NOT NULL,
  selected_tier INTEGER,
  line_total REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_sessions (
  id TEXT PRIMARY KEY,
  square_payment_id TEXT UNIQUE,
  customer_name TEXT NOT NULL,
  email TEXT,
  phone_number TEXT NOT NULL,
  cart_data TEXT NOT NULL,             -- JSON string
  fulfillment_data TEXT,               -- JSON string
  total_amount REAL NOT NULL,          -- tax-inclusive charged total (incl shipping)
  tax REAL DEFAULT 0,
  shipping REAL NOT NULL DEFAULT 0,    -- flat delivery fee (0 for pickup / free shipping)
  coupon_code TEXT,                         -- influencer coupon used (NULL if none)
  payment_status TEXT NOT NULL DEFAULT 'pending',
  order_id TEXT,
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL DEFAULT (datetime('now', '+30 minutes'))
);

CREATE TABLE IF NOT EXISTS event_orders (
  id TEXT PRIMARY KEY,
  customer_name TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  email TEXT,                          -- collected since 2026-07-30; NULL on older rows
  event_type TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  event_date TEXT NOT NULL,
  delivery_address TEXT,
  payment_status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Durable transactional-email outbox. Only the UUID is placed on the Queue;
-- customer addresses and rendered email content stay in D1.
CREATE TABLE IF NOT EXISTS email_outbox (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT UNIQUE NOT NULL,
  to_json TEXT NOT NULL,
  cc_json TEXT,
  bcc_json TEXT,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'retry', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  provider_message_id TEXT,
  last_error TEXT,
  next_attempt_at TEXT,
  lease_until TEXT,
  last_enqueued_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Stock counts for tracked products (pickles). IMPORTANT: a product with NO row
-- here is treated as UNTRACKED / always available, so adding this table can
-- never make an existing product silently disappear from the storefront.
CREATE TABLE IF NOT EXISTS inventory (
  product_id TEXT PRIMARY KEY,
  stock_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed the three pickles. `OR IGNORE` keeps existing counts on re-apply.
-- Starting value is a placeholder — set real counts in the admin dashboard.
INSERT OR IGNORE INTO inventory (product_id, stock_count) VALUES
  ('pickle-chicken', 20),
  ('pickle-mutton', 20),
  ('pickle-prawns', 20);

-- Influencer coupon codes — each code is tied to one influencer and adds
-- complimentary items (e.g. 2 pcs Malai Khaja) instead of a discount.
CREATE TABLE IF NOT EXISTS influencer_coupons (
  code TEXT PRIMARY KEY,                   -- uppercase, no spaces
  influencer_name TEXT NOT NULL,
  bonus_item TEXT NOT NULL DEFAULT 'Malai Khaja',  -- item added free
  bonus_qty INTEGER NOT NULL DEFAULT 2,
  times_used INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,       -- 1 = active, 0 = disabled
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Atomic order-number counter (replaces the Postgres sequence).
CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT OR IGNORE INTO counters (name, value) VALUES ('order_number', 1000);

CREATE INDEX IF NOT EXISTS idx_orders_payment ON orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_pickup_date ON orders(pickup_date);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_square_payment ON orders(square_payment_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_sessions_square ON payment_sessions(square_payment_id);
CREATE INDEX IF NOT EXISTS idx_events_date ON event_orders(event_date);
CREATE INDEX IF NOT EXISTS idx_email_outbox_delivery
  ON email_outbox(status, next_attempt_at, last_enqueued_at);
CREATE INDEX IF NOT EXISTS idx_email_outbox_created ON email_outbox(created_at);

-- Keep orders.updated_at current on every row change (refunds, status updates).
-- The WHEN guard skips rows where updated_at was already set by the statement;
-- SQLite also runs triggers non-recursively by default, so the inner UPDATE
-- here never re-fires this trigger.
CREATE TRIGGER IF NOT EXISTS trg_orders_updated_at
AFTER UPDATE ON orders
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE orders SET updated_at = datetime('now') WHERE id = NEW.id;
END;
