-- Anonymous checkout step counts (pickup vs delivery, sold-out pickup days,
-- delivery fee shown). One row per checkout visit and step; no customer data.
-- (024 is taken by the unreleased Shippo migration on the juices branch.)
CREATE TABLE IF NOT EXISTS checkout_funnel (
  visit_id TEXT NOT NULL,
  step TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (visit_id, step)
);
CREATE INDEX IF NOT EXISTS idx_checkout_funnel_created ON checkout_funnel(created_at);
