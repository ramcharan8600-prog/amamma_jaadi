-- Delivery areas the owner paused in Admin → Production ('texas', 'nearby', 'far').
-- Checkout hides delivery to them and the server refuses it (session and first charge).
CREATE TABLE IF NOT EXISTS delivery_pauses (
  zone TEXT PRIMARY KEY CHECK (zone IN ('texas', 'nearby', 'far')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
