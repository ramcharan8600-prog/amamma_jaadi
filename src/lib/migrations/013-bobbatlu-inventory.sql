-- Count individual pieces, not boxes. Zero means made to order (1 day).
-- Reapplying must preserve any count the owner already entered.
INSERT OR IGNORE INTO inventory (product_id, stock_count) VALUES ('sweet-bobbatlu', 0);
