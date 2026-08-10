import { NextRequest } from 'next/server';
import { getDb, isDbConfigured, newId } from '@/lib/db';
import { productNamesFromIds } from '@/data/products';
import { isEmailConfigured, sendEventInquiry } from '@/lib/email-service';
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
    const email = sanitize(body.email, 200);
    const deliveryAddress = sanitize(body.deliveryAddress, 500);

    // Validation
    if (!eventType || !phone || !eventDate) {
      return fail('Missing required fields', 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return fail('A valid email address is required', 400);
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

    // The form sends product ids; store readable names (e.g. "Kova, Bobbatlu").
    const sweetIds = Array.isArray(sweetSelection)
      ? sweetSelection.map((s: unknown) => sanitize(s, 50)).filter(Boolean)
      : [sanitize(sweetSelection, 200)].filter(Boolean);
    const productName = productNamesFromIds(sweetIds);
    const name = customerName || 'Guest';

    const id = newId();
    await getDb()
      .prepare(
        `INSERT INTO event_orders
          (id, customer_name, phone_number, event_type, product_name, quantity, event_date, delivery_address)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        name,
        phone,
        eventType,
        productName,
        quantity,
        eventDate,
        deliveryAddress || null
      )
      .run();

    // Confirm to the customer + CC the business inbox (best-effort — a mail
    // failure must not fail an inquiry that was already saved).
    if (isEmailConfigured()) {
      try {
        await sendEventInquiry({
          customerEmail: email,
          customerName: name,
          phone,
          eventType,
          eventDate,
          quantity,
          sweets: productName,
          deliveryAddress,
        });
      } catch (e) {
        console.error('[events] inquiry email failed:', e);
      }
    }

    return ok({ inquiry: { id } }, 201);
  } catch (e) {
    console.error('Event inquiry error:', e);
    return fail('Failed to submit inquiry', 500);
  }
}
