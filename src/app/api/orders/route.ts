import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getServiceClient, isSupabaseConfigured } from '@/lib/supabase';
import { verifySessionToken, SESSION_COOKIE } from '@/lib/session';
import { businessDateOffset } from '@/lib/date';
import { ok, fail } from '@/lib/api';

/**
 * GET /api/orders — Admin only: fetch PAID orders
 *
 * Production dashboard ONLY shows payment_status = 'paid'
 * No pending, failed, or canceled orders appear.
 */
export async function GET(request: NextRequest) {
  // Verify admin session
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE);
  if (!session?.value || !verifySessionToken(session.value)) {
    return fail('Unauthorized', 401);
  }

  try {
    if (!isSupabaseConfigured()) {
      return ok({ orders: [] });
    }

    const { searchParams } = new URL(request.url);
    const filter = searchParams.get('filter') || 'all';
    const db = getServiceClient();

    // CRITICAL: Only show paid orders — production dashboard relies on this.
    // Include nested order_items so analytics can compute product breakdowns.
    let query = db
      .from('orders')
      .select('*, order_items(*)')
      .eq('payment_status', 'paid')
      .order('created_at', { ascending: false });

    const today = businessDateOffset(0);
    const tomorrow = businessDateOffset(1);
    const dayAfter = businessDateOffset(2);

    switch (filter) {
      case 'today':
        // Filter by pickup_date so production planning sees orders due today
        query = query.eq('pickup_date', today);
        break;
      case 'tomorrow':
        query = query.eq('pickup_date', tomorrow);
        break;
      case 'future':
        // "Future" = the day after tomorrow onward (tomorrow has its own tab)
        query = query.gte('pickup_date', dayAfter).order('pickup_date', { ascending: true });
        break;
      case 'completed':
        query = query.eq('status', 'completed');
        break;
    }

    const { data, error } = await query.limit(200);
    if (error) throw error;

    return ok({ orders: data || [] });
  } catch (e) {
    console.error('Order fetch error:', e);
    return fail('Failed to fetch orders', 500);
  }
}
