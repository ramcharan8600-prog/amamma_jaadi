-- Owner-editable shop settings (key → value). First use: the weekly cap on
-- delivery orders ('weekly_delivery_limit'; no row = no cap).
CREATE TABLE IF NOT EXISTS shop_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
