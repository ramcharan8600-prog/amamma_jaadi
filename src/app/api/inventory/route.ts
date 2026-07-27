import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getDb, isDbConfigured } from '@/lib/db';
import { verifySessionToken, SESSION_COOKIE } from '@/lib/session';
import { getStockMap, setStock, TRACKED_PRODUCT_IDS } from '@/lib/inventory';
import { ok, fail } from '@/lib/api';

/**
 * GET /api/inventory — PUBLIC stock counts for tracked products.
 *
 * Used by the storefront to show "Out of Stock" / "Only N left". Exposes only
 * `{ productId: count }` for the tracked pickles — no customer or order data.
 * Returns an empty map when the DB isn't configured so the page still renders.
 */
export async function GET() {
  if (!isDbConfigured()) return ok({ stock: {} });
  try {
    return ok({ stock: await getStockMap(getDb()) });
  } catch (e) {
    console.error('[inventory] GET failed:', e);
    return ok({ stock: {} });
  }
}

/**
 * PATCH /api/inventory — ADMIN ONLY: set an absolute stock count.
 * Body: { productId: string, stockCount: number }
 */
export async function PATCH(request: NextRequest) {
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE);
  if (!session?.value || !verifySessionToken(session.value)) {
    return fail('Unauthorized', 401);
  }

  if (!isDbConfigured()) return fail('Not configured', 503);

  try {
    const body = await request.json();
    const productId = typeof body.productId === 'string' ? body.productId : '';
    const stockCount = Number(body.stockCount);

    // Only known tracked products — never let an arbitrary id create a row.
    if (!TRACKED_PRODUCT_IDS.includes(productId)) {
      return fail('Unknown product', 400);
    }
    if (!Number.isFinite(stockCount) || stockCount < 0 || stockCount > 100000) {
      return fail('Invalid stock count', 400);
    }

    const db = getDb();
    await setStock(db, productId, stockCount);
    return ok({ stock: await getStockMap(db) });
  } catch (e) {
    console.error('[inventory] PATCH failed:', e);
    return fail('Failed to update stock', 500);
  }
}
