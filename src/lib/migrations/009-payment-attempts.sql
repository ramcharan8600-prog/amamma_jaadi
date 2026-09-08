-- One durable charge attempt per checkout. Apply before deploying retry code.
-- request_json contains a short-lived Square token, never card numbers/CVV.
-- It is private server-side recovery data and is erased after a terminal result.
CREATE TABLE IF NOT EXISTS payment_attempts (
  session_id TEXT PRIMARY KEY REFERENCES payment_sessions(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  request_json TEXT,
  state TEXT NOT NULL CHECK (state IN ('processing', 'unknown', 'completed', 'declined')),
  square_payment_id TEXT,
  lease_token TEXT,
  lease_until TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_recovery
  ON payment_attempts(state, lease_until, updated_at);
