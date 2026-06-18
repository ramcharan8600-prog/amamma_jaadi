-- ============================================================
-- Migration 0001 — Address normalization + atomic order numbers
-- Run in the Supabase SQL editor on an existing database.
-- Safe to run more than once (idempotent).
-- ============================================================

-- 1. Store the Google-normalized delivery address on orders.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_address_normalized JSONB;

-- 2. Atomic, race-free order numbers via a sequence + function.
CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1001;

CREATE OR REPLACE FUNCTION next_order_number()
RETURNS TEXT AS $$
  SELECT 'AJ-' || nextval('order_number_seq')::TEXT;
$$ LANGUAGE sql;

GRANT EXECUTE ON FUNCTION next_order_number() TO anon, authenticated, service_role;

-- If you already have orders, advance the sequence past the current max so
-- new numbers never collide with existing ones:
SELECT setval(
  'order_number_seq',
  GREATEST(
    1000,
    COALESCE(
      (SELECT MAX(NULLIF(regexp_replace(order_number, '\D', '', 'g'), '')::BIGINT)
       FROM orders WHERE order_number LIKE 'AJ-%'),
      1000
    )
  )
);
