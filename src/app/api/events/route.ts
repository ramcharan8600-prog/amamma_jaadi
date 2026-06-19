import { NextRequest } from 'next/server';
import { getDb, isDbConfigured, newId } from '@/lib/db';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { sanitize } from '@/lib/sanitize';
import { ok, fail } from '@/lib/api';

export async function POST(request: NextRequest) {
  try {
    // Throttle abuse: 5 inquiries per minute per IP.
    if (!rateLimit(`events:${getClientIp(request)}`, 5, 60_000)) {
      return fail('Too many requests. Please slow down.', 429);
    }

    const body = await request.json();
    const eventType = sanitize(body.eventType, 100);
    const sweetSelection = body.sweetSelection;
    const quantity = Math.floor(Number(body.quantity));
    const phone = sanitize(body.phone, 20);
    const eventDate = sanitize(body.eventDate, 10);
    const customerName = sanitize(body.customerName, 100);
    const deliveryAddress = sanitize(body.deliveryAddress, 500);

    // Validation
    if (!eventType || !phone || !eventDate) {
      return fail('Missing required fields', 400);
    }
    if (isNaN(quantity) || quantity < 100) {
      return fail('Minimum event order is 100 pieces', 400);
    }

    const minDate = new Date();
    minDate.setDate(minDate.getDate() + 2);
    minDate.setHours(0, 0, 0, 0);
    if (new Date(eventDate) < minDate) {
      return fail('Event orders require minimum 2 days advance notice', 400);
    }

    if (!isDbConfigured()) {
      return fail('Event system not configured. Please contact us via WhatsApp.', 503);
    }

    const productName = Array.isArray(sweetSelection)
      ? sweetSelection.map((s: unknown) => sanitize(s, 50)).join(', ')
      : sanitize(sweetSelection, 200);

    const id = newId();
    await getDb()
      .prepare(
        `INSERT INTO event_orders
          (id, customer_name, phone_number, event_type, product_name, quantity, event_date, delivery_address)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        customerName || 'Guest',
        phone,
        eventType,
        productName,
        quantity,
        eventDate,
        deliveryAddress || null
      )
      .run();

    return ok({ inquiry: { id } }, 201);
  } catch (e) {
    console.error('Event inquiry error:', e);
    return fail('Failed to submit inquiry', 500);
  }
}
