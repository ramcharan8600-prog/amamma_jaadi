-- Assorted Bobbatlu Box (8 Bobbatlu + 8 Kova Bobbatlu) is counted in whole
-- boxes, separately from loose Bobbatlu pieces. It starts at 0 = Out of Stock
-- until the owner enters a count in the admin dashboard. Reapplying keeps any
-- existing count.
-- Apply to sandbox first:
--   npx wrangler d1 execute DB --env sandbox --remote --file=src/lib/migrations/019-assorted-bobbatlu-box-inventory.sql
INSERT OR IGNORE INTO inventory (product_id, stock_count) VALUES ('sweet-assorted-bobbatlu-box', 0);
