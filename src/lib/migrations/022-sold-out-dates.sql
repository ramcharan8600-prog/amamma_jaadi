-- Pickup dates the owner marked sold out in admin. Checkout greys them out with
-- "Sold out", and the server refuses pickup on them (session and first charge).
CREATE TABLE IF NOT EXISTS sold_out_dates (
  date TEXT PRIMARY KEY,                          -- YYYY-MM-DD, Dallas business date
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
