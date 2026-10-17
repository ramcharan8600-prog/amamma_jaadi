-- Delivery shipment week chosen at checkout (Monday, YYYY-MM-DD). Each week
-- takes up to the weekly delivery limit (shop_settings.weekly_delivery_limit).
ALTER TABLE orders ADD COLUMN ship_week TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_ship_week ON orders(ship_week);
