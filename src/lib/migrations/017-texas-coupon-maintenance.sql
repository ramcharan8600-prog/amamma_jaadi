-- Existing payable sessions retain their previous shipping rates and no maintenance fee.
ALTER TABLE payment_sessions ADD COLUMN maintenance_fee REAL NOT NULL DEFAULT 0 CHECK (maintenance_fee >= 0);
ALTER TABLE payment_sessions ADD COLUMN pricing_policy TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE orders ADD COLUMN maintenance_fee REAL NOT NULL DEFAULT 0 CHECK (maintenance_fee >= 0);
