import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Generates the next sequential order number.
 * Format: AJ-1001, AJ-1002, ...
 *
 * Primary path: the `next_order_number()` Postgres function (atomic, race-free,
 * backed by a sequence — see supabase-schema.sql / migration 0001).
 *
 * Fallback path (only if the function isn't deployed yet): a best-effort
 * read-then-write with collision retry. The fallback is NOT race-safe and exists
 * solely so the app keeps working before the migration is applied.
 */
export async function generateOrderNumber(): Promise<string> {
  const db = getServiceClient();

  // Primary: atomic sequence via RPC.
  const { data: rpcValue, error: rpcError } = await db.rpc('next_order_number');
  if (!rpcError && typeof rpcValue === 'string' && rpcValue.startsWith('AJ-')) {
    return rpcValue;
  }
  if (rpcError) {
    console.warn('next_order_number() RPC unavailable — falling back. Apply migration 0001.', rpcError.message);
  }

  // Fallback: read current max, then retry on collision.
  const { data } = await db
    .from('orders')
    .select('order_number')
    .like('order_number', 'AJ-%');

  const currentMax = (data ?? []).reduce((best, row) => {
    const n = parseInt(row.order_number.split('-')[1], 10);
    return isNaN(n) ? best : Math.max(best, n);
  }, 1000);

  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `AJ-${currentMax + 1 + attempt}`;
    const { data: existing } = await db
      .from('orders')
      .select('id')
      .eq('order_number', candidate)
      .maybeSingle();
    if (!existing) return candidate;
  }

  // Last resort: timestamp suffix to guarantee uniqueness.
  return `AJ-${currentMax + 1}-${Date.now().toString(36).toUpperCase()}`;
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export function isSupabaseConfigured(): boolean {
  return !!(supabaseUrl && supabaseAnonKey);
}

// Lazy-initialized clients — only created when Supabase is configured
let _client: SupabaseClient | null = null;
let _serviceClient: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }
  if (!_client) {
    _client = createClient(supabaseUrl, supabaseAnonKey);
  }
  return _client;
}

export function getServiceClient(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }
  if (!_serviceClient) {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (!serviceKey) {
      // Fail loudly: an empty key silently downgrades to anon, so RLS would
      // block webhook/order writes with a confusing error instead of this one.
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set — service client cannot be created.');
    }
    _serviceClient = createClient(supabaseUrl, serviceKey);
  }
  return _serviceClient;
}
