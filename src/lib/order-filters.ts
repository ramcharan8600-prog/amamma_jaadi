import { isShipWeek } from '@/lib/delivery-limit';
import { businessDateOffset, businessDateUtcRange } from '@/lib/date';
import { sanitize } from '@/lib/sanitize';
import { PICKUP_LOCATIONS } from '@/data/products';
import { isShipmentStatus } from '@/lib/shipment';

/** The admin order list's SQL filter: WHERE clauses with their binds, and the sort. */
export interface OrderFilters {
  where: string[];
  binds: unknown[];
  orderBy: string;
}

/**
 * Admin order filters from the query string (quick view, date, shipment status,
 * pickup location). Shared by the order list and its production summary so both
 * always cover the same orders.
 */
export function buildOrderFilters(searchParams: URLSearchParams): OrderFilters | { error: string } {
  // A search looks through every order, whichever quick view is selected.
  const search = sanitize(searchParams.get('q'), 100);
  const filter = search ? 'all' : searchParams.get('filter') || 'all';
  // `pickupDate` remains accepted for compatibility with an open dashboard
  // tab from the previous release; `date` covers both order types.
  const dateFilter = sanitize(
    searchParams.get('date') ?? searchParams.get('pickupDate'),
    10
  );
  const shipmentStatusFilter = sanitize(searchParams.get('shipmentStatus'), 30);
  const pickupLocation = sanitize(searchParams.get('pickupLocation'), 100);
  const shipWeek = sanitize(searchParams.get('shipWeek'), 10);
  // Paid and refunded orders remain visible so the dashboard reflects Square.
  const where = ["payment_status IN ('paid', 'partially_refunded', 'refunded')"];
  const binds: unknown[] = [];
  // Include a stable id tiebreaker so the order list and item subquery select
  // the same rows of a page even when multiple orders share a timestamp.
  let orderBy = 'created_at DESC, id DESC';

  switch (filter) {
    case 'today':
      where.push('pickup_date = ?');
      binds.push(businessDateOffset(0));
      break;
    case 'tomorrow':
      where.push('pickup_date = ?');
      binds.push(businessDateOffset(1));
      break;
    case 'future':
      // "Future" = the day after tomorrow onward (tomorrow has its own tab)
      where.push('pickup_date >= ?');
      binds.push(businessDateOffset(2));
      orderBy = 'pickup_date ASC, created_at ASC, id ASC';
      break;
    case 'completed':
      where.push("status = 'completed'");
      break;
  }

  if (dateFilter) {
    const deliveryDateRange = businessDateUtcRange(dateFilter);
    if (!deliveryDateRange) return { error: 'Invalid date filter' };
    where.push(`(
      (order_type = 'pickup' AND pickup_date = ?)
      OR
      (order_type = 'delivery' AND created_at >= ? AND created_at < ?)
    )`);
    binds.push(dateFilter, deliveryDateRange.start, deliveryDateRange.end);
  }

  if (shipmentStatusFilter) {
    if (shipmentStatusFilter === 'pickup') {
      where.push("order_type = 'pickup'");
    } else {
      if (!isShipmentStatus(shipmentStatusFilter)) {
        return { error: 'Invalid shipment status filter' };
      }
      where.push("order_type = 'delivery'");
      where.push('shipment_status = ?');
      binds.push(shipmentStatusFilter);
      if (shipmentStatusFilter === 'yet_to_ship') {
        // The outstanding-dispatch view is a work queue, not audit history.
        // Fully refunded or cancelled orders must never be packed.
        where.push("payment_status != 'refunded'");
        where.push("status != 'cancelled'");
      }
    }
  }

  if (pickupLocation === 'delivery') {
    // The admin "Delivery orders" choice in the same location filter.
    where.push("order_type = 'delivery'");
  } else if (pickupLocation) {
    const knownLocation = PICKUP_LOCATIONS.some((location) => location.id === pickupLocation);
    if (!knownLocation) return { error: 'Invalid pickup location filter' };
    where.push("order_type = 'pickup'");
    where.push('pickup_location = ?');
    binds.push(pickupLocation);
  }

  if (shipWeek === 'none') {
    where.push("order_type = 'delivery'");
    where.push('ship_week IS NULL');
  } else if (shipWeek) {
    if (!isShipWeek(shipWeek)) return { error: 'Invalid ship week filter' };
    where.push("order_type = 'delivery'");
    where.push('ship_week = ?');
    binds.push(shipWeek);
  }

  if (search) {
    const clause = searchClause(search);
    where.push(clause.sql);
    binds.push(...clause.binds);
  }

  return { where, binds, orderBy };
}

/** Phone numbers are stored as typed, so compare digits only. */
const DIGITS_ONLY_PHONE = "replace(replace(replace(replace(replace(replace(phone_number, '-', ''), ' ', ''), '(', ''), ')', ''), '+', ''), '.', '')";

/**
 * Search box: a name, phone number (any format), order number (AJ-1210 or 1210),
 * tracking number or email. Each word must match somewhere, so "ravi 214" finds
 * Ravi with a 214 number.
 */
function searchClause(search: string): { sql: string; binds: unknown[] } {
  const binds: unknown[] = [];
  const perWord = search.split(/\s+/).filter(Boolean).slice(0, 5).map((word) => {
    const like = `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const parts = [
      "customer_name LIKE ? ESCAPE '\\'",
      "order_number LIKE ? ESCAPE '\\'",
      "tracking_id LIKE ? ESCAPE '\\'",
      "email LIKE ? ESCAPE '\\'",
    ];
    binds.push(like, like, like, like);
    const digits = word.replace(/\D/g, '');
    // Phone only when the word is mostly digits, so "AJ-1210" is not read as a phone number.
    if (digits.length >= 3 && digits.length >= word.length - 2 && !/[a-z]/i.test(word)) {
      parts.push(`${DIGITS_ONLY_PHONE} LIKE ?`);
      binds.push(`%${digits}%`);
    }
    return `(${parts.join(' OR ')})`;
  });
  return { sql: perWord.join(' AND '), binds };
}
