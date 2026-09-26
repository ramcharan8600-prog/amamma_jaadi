-- Assorted Box (11 Malpuri + 11 Malai Khaja) is counted in whole boxes,
-- separately from loose sweets. It starts at 0 = Out of Stock until the owner
-- enters a count in the admin dashboard. Reapplying keeps any existing count.
-- Apply to sandbox first:
--   npx wrangler d1 execute DB --env sandbox --remote --file=src/lib/migrations/018-assorted-box-inventory.sql
INSERT OR IGNORE INTO inventory (product_id, stock_count) VALUES ('sweet-assorted-box', 0);
