-- ============================================================
-- Migration 0002 — Enforce one order per Square payment (idempotency)
-- Run in the Supabase SQL editor on an existing database.
-- ============================================================

-- Safety: surface any pre-existing duplicates before adding the constraint.
-- (Should return zero rows on a clean database.)
DO $$
DECLARE
  dup_count INT;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT square_payment_id
    FROM orders
    WHERE square_payment_id IS NOT NULL
    GROUP BY square_payment_id
    HAVING COUNT(*) > 1
  ) d;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Found % duplicate square_payment_id value(s) in orders. Resolve them before adding the unique constraint.', dup_count;
  END IF;
END $$;

-- Enforce uniqueness. NULLs are allowed (Postgres treats them as distinct),
-- so this only constrains real payment IDs. IF NOT EXISTS guard keeps it idempotent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_square_payment_id_key'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_square_payment_id_key UNIQUE (square_payment_id);
  END IF;
END $$;
