-- Customers the owner no longer accepts orders from (owner, 2026-10-17).
-- Checkout refuses a matching phone (10 US digits) or email before payment.
CREATE TABLE IF NOT EXISTS blocked_customers (
  phone TEXT PRIMARY KEY,
  email TEXT,
  name TEXT,
  order_number TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_blocked_customers_email ON blocked_customers(email);
