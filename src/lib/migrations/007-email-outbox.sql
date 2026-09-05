-- Durable transactional-email outbox. Apply before deploying the Queue worker.
-- Sandbox:
--   npx wrangler d1 execute DB --env sandbox --remote --file=src/lib/migrations/007-email-outbox.sql
-- Production:
--   npx wrangler d1 execute DB --remote --file=src/lib/migrations/007-email-outbox.sql

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

CREATE INDEX IF NOT EXISTS idx_email_outbox_delivery
  ON email_outbox(status, next_attempt_at, last_enqueued_at);

CREATE INDEX IF NOT EXISTS idx_email_outbox_created
  ON email_outbox(created_at);
