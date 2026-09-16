-- Apply before releasing the new product. Set the actual count in admin.
-- Reapplying preserves any stock count already entered.
INSERT OR IGNORE INTO inventory (product_id, stock_count)
VALUES ('pickle-gongura-chicken', 0);
