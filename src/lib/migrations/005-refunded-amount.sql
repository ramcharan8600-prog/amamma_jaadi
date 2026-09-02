-- Track the cumulative amount refunded so analytics can report net revenue.
ALTER TABLE orders ADD COLUMN refunded_amount REAL NOT NULL DEFAULT 0;
