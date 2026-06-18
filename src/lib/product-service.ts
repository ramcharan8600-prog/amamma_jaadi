/**
 * Product Service Layer — Production Grade
 *
 * Source of truth: Supabase database
 * Cache: Upstash Redis (or in-memory fallback)
 * Local data: Used ONLY as initial seed / emergency fallback
 *
 * Future: Square catalog → Supabase sync via webhook
 */

import { PRODUCTS, PICKUP_LOCATIONS } from '@/data/products';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import { cache, CACHE_KEYS, CACHE_TTL } from '@/lib/cache';
import type { Product, PickupLocation, ProductCategory } from '@/types';

/**
 * Fetch all active products.
 * Cache → Supabase → local fallback (dev only)
 */
export async function getProducts(): Promise<Product[]> {
  // 1. Check cache
  const cached = await cache.get<Product[]>(CACHE_KEYS.PRODUCTS_ALL);
  if (cached) return cached;

  // 2. Fetch from database
  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await getSupabase()
        .from('products')
        .select('*')
        .eq('active_status', true)
        .order('category');

      if (!error && data && data.length > 0) {
        const products = data.map(mapDbProduct);
        await cache.set(CACHE_KEYS.PRODUCTS_ALL, products, CACHE_TTL.PRODUCTS);
        return products;
      }

      // Database connected but empty — use local seed data
      if (!error && (!data || data.length === 0)) {
        console.warn('Products table is empty — using seed data. Run seed script to populate.');
        return PRODUCTS;
      }

      console.error('Supabase query error:', error);
    } catch (e) {
      console.error('Database fetch failed:', e);
    }
  }

  // 3. Local fallback (development without Supabase)
  return PRODUCTS;
}

export async function getProductsByCategory(category: string): Promise<Product[]> {
  const cacheKey = CACHE_KEYS.PRODUCTS_CATEGORY(category);
  const cached = await cache.get<Product[]>(cacheKey);
  if (cached) return cached;

  const products = await getProducts();
  const filtered = products.filter((p) => p.category === category);
  await cache.set(cacheKey, filtered, CACHE_TTL.PRODUCTS);
  return filtered;
}

export async function getProductById(id: string): Promise<Product | undefined> {
  const products = await getProducts();
  return products.find((p) => p.id === id);
}

export async function getPickupLocations(): Promise<PickupLocation[]> {
  const cached = await cache.get<PickupLocation[]>(CACHE_KEYS.PICKUP_LOCATIONS);
  if (cached) return cached;

  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await getSupabase()
        .from('pickup_locations')
        .select('*')
        .eq('active_status', true);

      if (!error && data && data.length > 0) {
        const locations = data.map((loc) => ({
          id: loc.id as string,
          name: loc.location_name as string,
          address: loc.address as string,
          city: (loc.city as string) || 'Dallas',
          state: (loc.state as string) || 'TX',
          zip: (loc.zip as string) || '',
        }));
        await cache.set(CACHE_KEYS.PICKUP_LOCATIONS, locations, CACHE_TTL.LOCATIONS);
        return locations;
      }
    } catch (e) {
      console.error('Pickup locations fetch failed:', e);
    }
  }

  return PICKUP_LOCATIONS;
}

/** Invalidate all product caches (call after Square sync or admin update) */
export async function invalidateProductCache(): Promise<void> {
  await cache.invalidatePrefix('products:');
}

/** Maps a Supabase product row to the frontend Product type */
function mapDbProduct(row: Record<string, unknown>): Product {
  const name = (row.product_name as string) || 'Unnamed Product';
  return {
    id: row.id as string,
    name,
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    category: row.category as ProductCategory,
    description: (row.description as string) || '',
    unitPrice: Number(row.price),
    image: (row.image_url as string) || '/images/products/placeholder.jpg',
    sizeLabel: (row.unit_label as string) || undefined,
    quantityOptions: row.tiers as number[] | undefined,
    inStock: (row.active_status as boolean) ?? true,
    tags: [],
  };
}
