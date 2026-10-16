import { cookies } from 'next/headers';
import { getDb, isDbConfigured } from '@/lib/db';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';
import {
  LABEL_PRICE_LIMIT, SHIP_BOXES, ShippingError, defaultShipDate, loadShippingOrder, purchaseLabel, quoteLabel,
  releaseStuckLabel, setShipRoute, voidOrderLabel,
} from '@/lib/shipping-labels';
import { ShippoError } from '@/lib/shippo';
import { shippoApiKey, shopShippingEmail } from '@/lib/shipping-env';

const noStore = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: noStore });

async function authed(): Promise<boolean> {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  return Boolean(session && verifySessionToken(session));
}

function failure(error: unknown) {
  if (error instanceof ShippingError) return json({ error: error.message, code: error.code }, error.status);
  if (error instanceof ShippoError) return json({ error: error.message, code: 'SHIPPO' }, 502);
  console.error(JSON.stringify({ event: 'shipping_admin_error', error: error instanceof Error ? error.message : String(error) }));
  return json({ error: 'Something went wrong. Please try again.' }, 500);
}

/** GET /api/admin/shipping?orderId= — Admin: the Ship panel's order, route, saved box/weight and labels. */
export async function GET(request: Request) {
  if (!(await authed())) return json({ error: 'Unauthorized' }, 401);
  if (!isDbConfigured()) return json({ error: 'Database unavailable' }, 503);
  const orderId = new URL(request.url).searchParams.get('orderId') ?? '';
  try {
    const order = await loadShippingOrder(getDb(), orderId);
    if (!order) return json({ error: 'Order not found' }, 404);
    return json({
      order, boxes: SHIP_BOXES, priceLimit: LABEL_PRICE_LIMIT, defaultShipDate: defaultShipDate(),
      shippoConfigured: Boolean(shippoApiKey()),
    });
  } catch (error) {
    return failure(error);
  }
}

/**
 * POST /api/admin/shipping — Admin actions for one order:
 * { action: 'quote', orderId, box, weightLb, shipDate } → rates (UPS Ground / 2nd Day Air)
 * { action: 'buy', orderId, rateId, shipDate, confirmOverLimit? } → the label
 * { action: 'void' | 'release', orderId }
 * { action: 'route', orderId, route: 'shippo' | 'pirate_ship' | null }
 */
export async function POST(request: Request) {
  if (!(await authed())) return json({ error: 'Unauthorized' }, 401);
  if (!isDbConfigured()) return json({ error: 'Database unavailable' }, 503);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const orderId = typeof body?.orderId === 'string' ? body.orderId : '';
  if (!orderId) return json({ error: 'Missing order.' }, 400);
  const db = getDb();
  try {
    switch (body?.action) {
      case 'quote':
        return json(await quoteLabel(db, shippoApiKey(), {
          orderId, box: String(body.box ?? ''), weightLb: Number(body.weightLb), shipDate: String(body.shipDate ?? ''),
        }));
      case 'buy':
        return json({ label: await purchaseLabel(db, shippoApiKey(), {
          orderId, rateId: String(body.rateId ?? ''), shipDate: String(body.shipDate ?? defaultShipDate()),
          confirmOverLimit: body.confirmOverLimit === true, shopEmail: shopShippingEmail(),
        }) });
      case 'void':
        await voidOrderLabel(db, shippoApiKey(), orderId);
        return json({ ok: true });
      case 'release':
        await releaseStuckLabel(db, orderId);
        return json({ ok: true });
      case 'route': {
        const route = body.route === 'shippo' || body.route === 'pirate_ship' ? body.route : null;
        await setShipRoute(db, orderId, route);
        return json({ ok: true });
      }
      default:
        return json({ error: 'Unknown action.' }, 400);
    }
  } catch (error) {
    return failure(error);
  }
}
