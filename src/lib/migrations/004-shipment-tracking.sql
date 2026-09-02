-- Migration: delivery shipment status and manually entered tracking number.
-- Apply to sandbox first:
--   npx wrangler d1 execute DB --env sandbox --remote --file=src/lib/migrations/004-shipment-tracking.sql

ALTER TABLE orders ADD COLUMN shipment_status TEXT NOT NULL DEFAULT 'yet_to_ship'
  CHECK (shipment_status IN ('yet_to_ship', 'shipped', 'delivered'));

ALTER TABLE orders ADD COLUMN tracking_id TEXT;
