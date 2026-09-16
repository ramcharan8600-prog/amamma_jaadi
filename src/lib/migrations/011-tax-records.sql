-- Additive only. Historical receipts are never repriced or guessed.
CREATE TABLE IF NOT EXISTS payment_tax_quotes (
  session_id TEXT PRIMARY KEY REFERENCES payment_sessions(id),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payment_receipts (
  session_id TEXT PRIMARY KEY REFERENCES payment_sessions(id),
  square_payment_id TEXT NOT NULL UNIQUE,
  paid_at TEXT NOT NULL,
  date_source TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_tax_records (
  order_id TEXT PRIMARY KEY REFERENCES orders(id),
  session_id TEXT UNIQUE REFERENCES payment_sessions(id),
  paid_at TEXT NOT NULL,
  date_source TEXT NOT NULL,
  environment TEXT NOT NULL,
  destination_state TEXT,
  destination_city TEXT,
  destination_zip TEXT,
  merchandise_cents INTEGER NOT NULL CHECK (merchandise_cents >= 0),
  taxable_merchandise_cents INTEGER NOT NULL CHECK (taxable_merchandise_cents >= 0),
  exempt_merchandise_cents INTEGER NOT NULL CHECK (exempt_merchandise_cents >= 0),
  shipping_cents INTEGER NOT NULL CHECK (shipping_cents >= 0),
  taxable_shipping_cents INTEGER NOT NULL CHECK (taxable_shipping_cents BETWEEN 0 AND shipping_cents),
  tax_cents INTEGER NOT NULL CHECK (tax_cents >= 0),
  total_cents INTEGER NOT NULL,
  rate_basis_points INTEGER NOT NULL,
  shipping_tax_rule TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  review_reason TEXT,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (taxable_merchandise_cents + exempt_merchandise_cents = merchandise_cents),
  CHECK (merchandise_cents + shipping_cents + tax_cents = total_cents)
);
CREATE INDEX IF NOT EXISTS idx_order_tax_paid_at ON order_tax_records(paid_at);

-- Refund facts are separate events: a Q4 refund must not rewrite a Q3 sale.
CREATE TABLE IF NOT EXISTS order_refunds (
  square_refund_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  square_payment_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  refunded_at TEXT NOT NULL,
  date_source TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_order_refunds_date ON order_refunds(refunded_at);
CREATE INDEX IF NOT EXISTS idx_order_refunds_order ON order_refunds(order_id);

-- Corrections append a new allocation; the original refund and audit trail stay.
CREATE TABLE IF NOT EXISTS refund_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  square_refund_id TEXT NOT NULL REFERENCES order_refunds(square_refund_id),
  taxable_merchandise_cents INTEGER NOT NULL CHECK (taxable_merchandise_cents >= 0),
  exempt_merchandise_cents INTEGER NOT NULL CHECK (exempt_merchandise_cents >= 0),
  shipping_cents INTEGER NOT NULL CHECK (shipping_cents >= 0),
  taxable_shipping_cents INTEGER NOT NULL CHECK (taxable_shipping_cents BETWEEN 0 AND shipping_cents),
  tax_cents INTEGER NOT NULL CHECK (tax_cents >= 0),
  note TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_refund_allocations_refund ON refund_allocations(square_refund_id, id);

CREATE TRIGGER IF NOT EXISTS trg_tax_quote_immutable BEFORE UPDATE ON payment_tax_quotes
BEGIN SELECT RAISE(ABORT, 'Tax quotes are immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_tax_record_immutable BEFORE UPDATE ON order_tax_records
BEGIN SELECT RAISE(ABORT, 'Order tax records are immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_refund_allocation_immutable BEFORE UPDATE ON refund_allocations
BEGIN SELECT RAISE(ABORT, 'Append a refund allocation correction instead'); END;
