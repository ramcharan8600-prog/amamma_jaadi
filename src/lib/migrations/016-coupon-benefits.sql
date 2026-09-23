-- Apply before deploying the coupon benefit selector.
-- Existing coupons retain their complimentary items and quantities.
ALTER TABLE influencer_coupons ADD COLUMN coupon_type TEXT NOT NULL DEFAULT 'complimentary'
  CHECK (coupon_type IN ('complimentary', 'free_delivery'));
ALTER TABLE influencer_coupons ADD COLUMN min_subtotal REAL NOT NULL DEFAULT 0
  CHECK (min_subtotal >= 0);

-- Preserve the benefit promised at checkout, including after a coupon is disabled.
-- Older sessions have no snapshot and resolve their original coupon as before.
ALTER TABLE payment_sessions ADD COLUMN coupon_snapshot TEXT;
