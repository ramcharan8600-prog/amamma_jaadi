-- ============================================================
-- Amamma Jaadi — Supabase Database Schema
-- Run this in the Supabase SQL Editor to set up the database.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Products ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('pickles','sweets','gift-boxes')),
  product_type TEXT, -- e.g. 'jar', 'box', 'gift'
  price NUMERIC(10,2) NOT NULL,
  stock_quantity INTEGER DEFAULT 0,
  image_url TEXT,
  square_product_id TEXT, -- synced from Square catalog
  active_status BOOLEAN DEFAULT true,
  description TEXT,
  unit_label TEXT, -- e.g. '16 oz jar', 'per piece'
  tiers JSONB, -- for sweets: [{pieces: 16, price: X}, ...]
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Pickup Locations ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pickup_locations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  location_name TEXT NOT NULL,
  address TEXT NOT NULL,
  active_status BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Orders ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  email TEXT,
  order_type TEXT NOT NULL CHECK (order_type IN ('pickup','delivery')),
  pickup_date DATE,
  pickup_location TEXT,
  delivery_address TEXT,
  delivery_address_normalized JSONB, -- Google-normalized address (delivery only)
  payment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending','paid','failed','refunded')),
  total_price NUMERIC(10,2) NOT NULL,
  tax NUMERIC(10,2) DEFAULT 0,
  square_payment_id TEXT UNIQUE, -- webhook idempotency: one order per payment
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','preparing','ready','completed','cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Order Items ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  product_name TEXT NOT NULL, -- denormalized for history
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  product_price NUMERIC(10,2) NOT NULL,
  selected_tier INTEGER, -- for sweets: pieces per box
  line_total NUMERIC(10,2) NOT NULL
);

-- ── Event Orders ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_name TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  event_type TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity >= 100),
  event_date DATE NOT NULL,
  delivery_address TEXT,
  payment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending','confirmed','completed')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_products_active ON products(active_status);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_payment ON orders(payment_status);
CREATE INDEX idx_orders_created ON orders(created_at);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_events_date ON event_orders(event_date);
CREATE INDEX idx_pickup_active ON pickup_locations(active_status);

-- ── Row Level Security ────────────────────────────────────────
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE pickup_locations ENABLE ROW LEVEL SECURITY;

-- Public read for products and locations
CREATE POLICY "Public can read active products"
  ON products FOR SELECT USING (active_status = true);

CREATE POLICY "Public can read active locations"
  ON pickup_locations FOR SELECT USING (active_status = true);

-- Public can create orders
CREATE POLICY "Public can create orders"
  ON orders FOR INSERT WITH CHECK (true);

CREATE POLICY "Public can create order items"
  ON order_items FOR INSERT WITH CHECK (true);

CREATE POLICY "Public can create event orders"
  ON event_orders FOR INSERT WITH CHECK (true);

-- Admin (authenticated) full access
CREATE POLICY "Admin read orders" ON orders
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Admin update orders" ON orders
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Admin manage products" ON products
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Admin read order items" ON order_items
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Admin read events" ON event_orders
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Admin update events" ON event_orders
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Admin manage locations" ON pickup_locations
  FOR ALL USING (auth.role() = 'authenticated');

-- ── Payment Sessions (temporary pre-order tracking) ───────────
CREATE TABLE IF NOT EXISTS payment_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  square_payment_id TEXT UNIQUE,
  customer_name TEXT NOT NULL,
  email TEXT,
  phone_number TEXT NOT NULL,
  cart_data JSONB NOT NULL,
  fulfillment_data JSONB,
  total_amount NUMERIC(10,2) NOT NULL,
  tax NUMERIC(10,2) DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending','completed','failed','expired')),
  order_id UUID REFERENCES orders(id), -- set only after verified payment
  idempotency_key TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 minutes')
);

CREATE INDEX idx_payment_sessions_status ON payment_sessions(payment_status);
CREATE INDEX idx_payment_sessions_square ON payment_sessions(square_payment_id);
CREATE INDEX idx_payment_sessions_expires ON payment_sessions(expires_at);

ALTER TABLE payment_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can create payment sessions"
  ON payment_sessions FOR INSERT WITH CHECK (true);

CREATE POLICY "Admin read payment sessions" ON payment_sessions
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "System update payment sessions" ON payment_sessions
  FOR UPDATE WITH CHECK (true);

-- ── Atomic order-number generation ────────────────────────────
-- A Postgres sequence guarantees gap-tolerant, race-free order numbers.
-- Replaces the read-then-write scan in lib/supabase.ts.
CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1001;

CREATE OR REPLACE FUNCTION next_order_number()
RETURNS TEXT AS $$
  SELECT 'AJ-' || nextval('order_number_seq')::TEXT;
$$ LANGUAGE sql;

-- Allow the API (anon + service roles) to call it.
GRANT EXECUTE ON FUNCTION next_order_number() TO anon, authenticated, service_role;

-- ── Updated-at trigger ────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
