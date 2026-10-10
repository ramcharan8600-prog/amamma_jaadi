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
  const filter = searchParams.get('filter') || 'all';
  // `pickupDate` remains accepted for compatibility with an open dashboard
  // tab from the previous release; `date` covers both order types.
  const dateFilter = sanitize(
    searchParams.get('date') ?? searchParams.get('pickupDate'),
    10
  );
  const shipmentStatusFilter = sanitize(searchParams.get('shipmentStatus'), 30);
  const pickupLocation = sanitize(searchParams.get('pickupLocation'), 100);
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

  return { where, binds, orderBy };
}
