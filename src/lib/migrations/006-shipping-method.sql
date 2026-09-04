-- Persist the customer-selected delivery speed on completed orders.
-- Existing orders remain NULL; new delivery orders use standard/ground/expedited.
ALTER TABLE orders ADD COLUMN shipping_method TEXT
  CHECK (shipping_method IN ('standard', 'ground', 'expedited'));
