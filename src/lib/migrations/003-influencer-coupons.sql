-- Migration: Influencer coupon system
-- Run with: wrangler d1 execute amammajaadi --remote --file=src/lib/migrations/003-influencer-coupons.sql

-- 1. Create the influencer_coupons table
CREATE TABLE IF NOT EXISTS influencer_coupons (
  code TEXT PRIMARY KEY,
  influencer_name TEXT NOT NULL,
  bonus_item TEXT NOT NULL DEFAULT 'Malai Khaja',
  bonus_qty INTEGER NOT NULL DEFAULT 2,
  times_used INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Add coupon_code column to existing tables
ALTER TABLE orders ADD COLUMN coupon_code TEXT;
ALTER TABLE payment_sessions ADD COLUMN coupon_code TEXT;
