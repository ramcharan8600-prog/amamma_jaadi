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
  total_price REAL NOT NULL,
  tax REAL DEFAULT 0,
  square_payment_id TEXT UNIQUE,       -- webhook idempotency: one order per payment
  status TEXT NOT NULL DEFAULT 'confirmed',
  payment_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
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
  total_amount REAL NOT NULL,
  tax REAL DEFAULT 0,
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
  event_type TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  event_date TEXT NOT NULL,
  delivery_address TEXT,
  payment_status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
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
