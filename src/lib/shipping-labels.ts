import type { D1Database, Queue } from '@cloudflare/workers-types';
import { toBusinessDateString } from '@/lib/date';
import { effectiveShipRoute, isMalaiKhajaGround, isPickleOnly, stateFromAddress, type ShipRoute } from '@/lib/ship-routing';
import {
  ShippoError, buyLabel, createShipment, getRate, validateAddress, voidLabel,
  type ShippoAddress, type ShippoRate,
} from '@/lib/shippo';
import { buildShippingLabelEmail } from '@/lib/email-service';
import { prepareEmailOutboxInsert, publishPersistedEmail, type EmailOutboxPayload, type EmailQueueMessage } from '@/lib/email-outbox';

/** Labels above this need an extra confirmation before buying (owner rule 6). */
export const LABEL_PRICE_LIMIT = 20;

/** The shop's boxes (inches). All three weigh 0.4 lb empty. */
export const SHIP_BOXES = [
  { id: '9x9x6', label: '9 × 9 × 6 in', length: 9, width: 9, height: 6 },
  { id: '11x7.5x5.5', label: '11 × 7.5 × 5.5 in', length: 11, width: 7.5, height: 5.5 },
  { id: '12x8x10', label: '12 × 8 × 10 in', length: 12, width: 8, height: 10 },
] as const;

/** "9x9x6" or any "LxWxH" in inches (Other). */
export function parseBox(box: unknown): { length: number; width: number; height: number } | null {
  if (typeof box !== 'string') return null;
  const parts = box.toLowerCase().replace(/\s+/g, '').split('x').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n) || n <= 0 || n > 108)) return null;
  const [length, width, height] = parts;
  return { length, width, height };
}

export class ShippingError extends Error {
  constructor(message: string, readonly code = 'INVALID', readonly status = 400) {
    super(message);
    this.name = 'ShippingError';
  }
}

export interface LabelRow {
  id: string;
  order_id: string;
  status: 'buying' | 'purchased' | 'voided' | 'failed';
  shippo_shipment_id: string | null;
  shippo_rate_id: string | null;
  shippo_transaction_id: string | null;
  provider: string | null;
  service_token: string | null;
  service_name: string | null;
  amount: number | null;
  currency: string | null;
  box: string | null;
  weight_lb: number | null;
  ship_date: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  label_url: string | null;
  error: string | null;
  created_at: string;
  purchased_at: string | null;
  voided_at: string | null;
  scanned_at: string | null;
}

export interface ShippingOrder {
  id: string;
  orderNumber: string;
  customerName: string;
  email: string | null;
  orderType: string;
  paymentStatus: string;
  status: string;
  shipmentStatus: string;
  trackingId: string | null;
  createdAt: string;
  addressText: string | null;
  address: ShippoAddress | null;
  state: string | null;
  shippingPaid: number | null;
  items: Array<{ product_name: string; quantity: number; selected_tier: number | null }>;
  route: ShipRoute;
  autoRoute: ShipRoute;
  routeReason: string;
  routeOverride: ShipRoute | null;
  box: string | null;
  weightLb: number | null;
  pickleOnly: boolean;
  groundOnly: boolean;
  activeLabel: LabelRow | null;
  labels: LabelRow[];
}

/** Structured address from the paid checkout session, else the saved address text. */
function addressFrom(fulfillmentJson: string | null, addressText: string | null, fallbackName: string, phone: string, email: string | null): ShippoAddress | null {
  try {
    const f = fulfillmentJson ? JSON.parse(fulfillmentJson) : null;
    if (f?.type === 'delivery' && f.addressLine1 && f.city && f.state && f.zip) {
      return {
        name: String(f.customerName || fallbackName), street1: String(f.addressLine1), street2: f.addressLine2 ? String(f.addressLine2) : undefined,
        city: String(f.city), state: String(f.state).toUpperCase(), zip: String(f.zip),
        country: /^(us|usa|united states)$/i.test(String(f.country ?? 'US')) ? 'US' : String(f.country),
        phone: String(f.phone || phone), email: f.email ? String(f.email) : email ?? undefined,
      };
    }
  } catch {
    // Fall back to the saved text below.
  }
  const lines = (addressText ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const cityLine = lines.findIndex((l) => /,\s*[A-Za-z]{2}\s+\d{5}/.test(l));
  if (cityLine < 1) return null;
  const m = /^(.*),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)/.exec(lines[cityLine])!;
  return {
    name: fallbackName, street1: lines[0], street2: cityLine > 1 ? lines.slice(1, cityLine).join(', ') : undefined,
    city: m[1], state: m[2].toUpperCase(), zip: m[3], country: 'US', phone, email: email ?? undefined,
  };
}

export async function loadShippingOrder(db: D1Database, orderId: string): Promise<ShippingOrder | null> {
  const row = await db.prepare(
    `SELECT o.*, ps.fulfillment_data AS fulfillment_data, ps.shipping AS shipping_paid
     FROM orders o
     LEFT JOIN order_finalizations f ON f.order_id = o.id
     LEFT JOIN payment_sessions ps ON ps.id = f.payment_session_id
     WHERE o.id = ?`,
  ).bind(orderId).first<Record<string, unknown>>();
  if (!row) return null;
  const [items, labels] = await Promise.all([
    db.prepare('SELECT product_name, quantity, selected_tier FROM order_items WHERE order_id = ? ORDER BY rowid')
      .bind(orderId).all<ShippingOrder['items'][number]>(),
    db.prepare('SELECT * FROM shipping_labels WHERE order_id = ? ORDER BY created_at DESC, rowid DESC')
      .bind(orderId).all<LabelRow>(),
  ]);
  const address = addressFrom(row.fulfillment_data as string | null, row.delivery_address as string | null,
    String(row.customer_name), String(row.phone_number ?? ''), (row.email as string | null) ?? null);
  const state = address?.state ?? stateFromAddress(row.delivery_address as string | null);
  const lines = items.results ?? [];
  const override = row.ship_route === 'shippo' || row.ship_route === 'pirate_ship' ? row.ship_route : null;
  const routing = effectiveShipRoute(override, state, lines);
  const labelRows = labels.results ?? [];
  return {
    id: String(row.id), orderNumber: String(row.order_number), customerName: String(row.customer_name),
    email: (row.email as string | null) ?? null, orderType: String(row.order_type), paymentStatus: String(row.payment_status),
    status: String(row.status), shipmentStatus: String(row.shipment_status ?? 'yet_to_ship'),
    trackingId: (row.tracking_id as string | null) ?? null, createdAt: String(row.created_at),
    addressText: (row.delivery_address as string | null) ?? null, address, state,
    shippingPaid: row.shipping_paid == null ? null : Number(row.shipping_paid),
    items: lines, route: routing.route, autoRoute: routing.auto.route, routeReason: routing.auto.reason,
    routeOverride: override, box: (row.ship_box as string | null) ?? null,
    weightLb: row.ship_weight_lb == null ? null : Number(row.ship_weight_lb),
    pickleOnly: isPickleOnly(lines),
    groundOnly: isMalaiKhajaGround(lines),
    activeLabel: labelRows.find((l) => l.status === 'buying' || l.status === 'purchased') ?? null,
    labels: labelRows,
  };
}

function requireShippable(order: ShippingOrder | null): ShippingOrder {
  if (!order) throw new ShippingError('Order not found.', 'NOT_FOUND', 404);
  if (order.orderType !== 'delivery') throw new ShippingError('Only delivery orders get a shipping label.');
  if (!['paid', 'partially_refunded'].includes(order.paymentStatus) || order.status === 'cancelled') {
    throw new ShippingError('This order was refunded or cancelled, so it should not ship.');
  }
  if (order.shipmentStatus !== 'yet_to_ship') throw new ShippingError('This order is already shipped.');
  return order;
}

// ─── Rates ────────────────────────────────────────────────────

export type ServiceKey = 'ground' | 'air' | 'ground_saver';
const SERVICE_NAMES: Record<ServiceKey, string> = { ground: 'UPS Ground', air: 'UPS 2nd Day Air', ground_saver: 'UPS Ground Saver' };

/** Which UPS service a Shippo rate is (only the owner's three are ever offered). */
export function serviceKey(rate: Pick<ShippoRate, 'provider' | 'serviceToken' | 'serviceName'>): ServiceKey | null {
  if (!/ups/i.test(rate.provider)) return null;
  const token = rate.serviceToken.toLowerCase();
  const name = rate.serviceName.toLowerCase();
  if (token === 'ups_ground_saver' || token === 'ups_surepost' || name.includes('ground saver')) return 'ground_saver';
  if (token === 'ups_ground' || name === 'ground') return 'ground';
  if (token === 'ups_second_day_air' || name === '2nd day air') return 'air';
  return null;
}

/** YYYY-MM-DD plus n business days (Mon–Fri; UPS holidays not counted). */
export function addBusinessDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}

/** Default ship date: today on a weekday before 5 PM Dallas time, else the next weekday. */
export function defaultShipDate(now = new Date()): string {
  const today = toBusinessDateString(now);
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hourCycle: 'h23' }).format(now));
  const day = new Date(`${today}T00:00:00Z`).getUTCDay();
  if (day !== 0 && day !== 6 && hour < 17) return today;
  return addBusinessDays(today, 1);
}

export interface RateOption {
  rateId: string;
  service: ServiceKey;
  serviceName: string;
  amount: number;
  currency: string;
  estimatedDays: number | null;
  arrivesOn: string | null;
  /** What the customer paid for shipping minus this label (null if unknown). */
  margin: number | null;
  recommended: boolean;
  overLimit: boolean;
}

/**
 * The owner's choices only: pickle-only → Ground Saver (or Ground if not
 * offered); Malai Khaja → Ground (2nd Day Air only if Ground is not offered);
 * everything else → Ground and 2nd Day Air. ⭐ = cheapest that arrives no
 * later than 2nd Day Air.
 */
export function rateOptions(rates: ShippoRate[], params: { pickleOnly: boolean; groundOnly?: boolean; shipDate: string; shippingPaid: number | null }): RateOption[] {
  const best = new Map<ServiceKey, ShippoRate>();
  for (const rate of rates) {
    const key = serviceKey(rate);
    if (!key || !Number.isFinite(rate.amount)) continue;
    const current = best.get(key);
    if (!current || rate.amount < current.amount) best.set(key, rate);
  }
  const wanted: ServiceKey[] = params.pickleOnly
    ? (best.has('ground_saver') ? ['ground_saver'] : ['ground'])
    : params.groundOnly
      ? (best.has('ground') ? ['ground'] : ['air'])
      : ['ground', 'air'];
  const options = wanted.filter((k) => best.has(k)).map((service) => {
    const r = best.get(service)!;
    return {
      rateId: r.rateId, service, serviceName: SERVICE_NAMES[service], amount: r.amount, currency: r.currency,
      estimatedDays: r.estimatedDays,
      arrivesOn: r.estimatedDays == null ? null : addBusinessDays(params.shipDate, r.estimatedDays),
      margin: params.shippingPaid == null ? null : Math.round((params.shippingPaid - r.amount) * 100) / 100,
      recommended: false, overLimit: r.amount > LABEL_PRICE_LIMIT,
    } satisfies RateOption;
  });
  const air = options.find((o) => o.service === 'air');
  const fastEnough = options.filter((o) => !air || !o.arrivesOn || !air.arrivesOn || o.arrivesOn <= air.arrivesOn);
  const pick = (fastEnough.length ? fastEnough : options).reduce<RateOption | null>((a, b) => (!a || b.amount < a.amount ? b : a), null);
  if (pick) pick.recommended = true;
  return options;
}

export async function quoteLabel(db: D1Database, apiKey: string, input: {
  orderId: string; box: string; weightLb: number; shipDate: string;
}) {
  const order = requireShippable(await loadShippingOrder(db, input.orderId));
  if (order.route !== 'shippo') throw new ShippingError('This order is set to Pirate Ship. Switch it to Shippo first.');
  if (order.activeLabel) throw new ShippingError('This order already has a label. Void it first to buy another.');
  const parcel = parseBox(input.box);
  if (!parcel) throw new ShippingError('Choose a box, or enter Other as length × width × height in inches.');
  if (!Number.isFinite(input.weightLb) || input.weightLb < 0.1 || input.weightLb > 150) {
    throw new ShippingError('Enter the packed weight in lb (box included), e.g. 2.4.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.shipDate) || input.shipDate < toBusinessDateString(new Date())) {
    throw new ShippingError('Choose a ship date from today on.');
  }
  if (!order.address) throw new ShippingError('This order has no complete delivery address.');
  await db.prepare('UPDATE orders SET ship_box = ?, ship_weight_lb = ? WHERE id = ?')
    .bind(input.box, input.weightLb, order.id).run();

  const addressCheck = await validateAddress(apiKey, order.address)
    .catch((e: unknown) => ({ valid: null, messages: [`Address check unavailable: ${e instanceof Error ? e.message : String(e)}`] }));
  const shipment = await createShipment(apiKey, {
    to: order.address, parcel: { ...parcel, weightLb: input.weightLb }, shipDate: input.shipDate, reference: order.orderNumber,
  });
  const rates = rateOptions(shipment.rates, { pickleOnly: order.pickleOnly, groundOnly: order.groundOnly, shipDate: input.shipDate, shippingPaid: order.shippingPaid });
  return { shipmentId: shipment.shipmentId, shipDate: input.shipDate, rates, addressCheck, messages: shipment.messages };
}

// ─── Buy / void / release ─────────────────────────────────────

/** Persist an email, then publish it (the cron republishes if the queue is down). */
async function queueEmail(db: D1Database, payload: EmailOutboxPayload, queue?: Queue<EmailQueueMessage>) {
  await prepareEmailOutboxInsert(db, payload).statement.run();
  await publishPersistedEmail(db, payload.dedupeKey, queue);
}

function cityState(order: ShippingOrder): string {
  return order.address ? `${order.address.city}, ${order.address.state}` : order.state ?? '';
}

export async function purchaseLabel(db: D1Database, apiKey: string, input: {
  orderId: string; rateId: string; confirmOverLimit?: boolean; shipDate: string;
  shopEmail: string | null; queue?: Queue<EmailQueueMessage>;
}): Promise<LabelRow> {
  const order = requireShippable(await loadShippingOrder(db, input.orderId));
  if (order.route !== 'shippo') throw new ShippingError('This order is set to Pirate Ship.');
  if (order.activeLabel) throw new ShippingError('This order already has a label.', 'ALREADY_LABELED', 409);
  if (!order.box || !order.weightLb) throw new ShippingError('Get label ETA first (box and weight).');
  if (!order.address) throw new ShippingError('This order has no complete delivery address.');

  // Owner's rule: no label unless UPS/USPS confirms the address. Checked again here, never taken from the browser.
  const addressCheck = await validateAddress(apiKey, order.address).catch(() => null);
  if (addressCheck?.valid !== true) {
    throw new ShippingError(addressCheck?.valid === false
      ? ['No label bought: UPS/USPS could not confirm this address.', ...addressCheck.messages, 'Check it with the customer.'].join(' ')
      : 'No label bought: the address check gave no clear answer. Try Get label ETA again in a minute.', 'ADDRESS_NOT_CONFIRMED', 409);
  }

  // Price and service come from Shippo, never from the browser.
  const rate = await getRate(apiKey, input.rateId);
  const key = serviceKey(rate);
  if (!key) throw new ShippingError('Only UPS Ground, 2nd Day Air or Ground Saver labels can be bought here.');
  if (rate.amount > LABEL_PRICE_LIMIT && !input.confirmOverLimit) {
    throw new ShippingError(`This label costs $${rate.amount.toFixed(2)}, over $${LABEL_PRICE_LIMIT}. Confirm to buy it.`, 'CONFIRM_OVER_LIMIT', 409);
  }

  // Claim the order first: the unique index allows one buying/purchased label per order.
  const id = crypto.randomUUID();
  try {
    await db.prepare(
      `INSERT INTO shipping_labels (id, order_id, status, shippo_shipment_id, shippo_rate_id, provider, service_token, service_name,
         amount, currency, box, weight_lb, ship_date)
       VALUES (?, ?, 'buying', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, order.id, rate.shipmentId, input.rateId, rate.provider, rate.serviceToken, SERVICE_NAMES[key],
      rate.amount, rate.currency, order.box, order.weightLb, input.shipDate).run();
  } catch {
    throw new ShippingError('A label for this order is already being bought or exists.', 'ALREADY_LABELED', 409);
  }

  let purchase;
  try {
    purchase = await buyLabel(apiKey, input.rateId, order.orderNumber);
  } catch (error) {
    // Unknown outcome: keep the claim so nobody buys twice; the owner checks Shippo, then Releases.
    const message = error instanceof Error ? error.message : String(error);
    const definite = error instanceof ShippoError && error.status !== undefined && error.status < 500;
    await db.prepare(`UPDATE shipping_labels SET status = ?, error = ? WHERE id = ?`)
      .bind(definite ? 'failed' : 'buying', message, id).run();
    throw new ShippingError(definite
      ? `Shippo refused the label: ${message}`
      : 'We could not confirm the purchase with Shippo. Check the Shippo dashboard, then use Release if no label was bought.', 'UNCONFIRMED', 502);
  }

  if (purchase.status !== 'SUCCESS' || !purchase.labelUrl) {
    const failed = purchase.status === 'ERROR';
    await db.prepare(`UPDATE shipping_labels SET status = ?, shippo_transaction_id = ?, error = ? WHERE id = ?`)
      .bind(failed ? 'failed' : 'buying', purchase.transactionId, purchase.messages.join(' ') || purchase.status, id).run();
    throw new ShippingError(failed
      ? `Shippo could not create the label: ${purchase.messages.join(' ') || 'unknown error'}`
      : 'Shippo is still creating the label. Use Check again in a minute.', failed ? 'LABEL_FAILED' : 'PENDING', 502);
  }

  await db.batch([
    db.prepare(
      `UPDATE shipping_labels SET status = 'purchased', shippo_transaction_id = ?, tracking_number = ?, tracking_url = ?,
         label_url = ?, error = NULL, purchased_at = datetime('now') WHERE id = ?`,
    ).bind(purchase.transactionId, purchase.trackingNumber, purchase.trackingUrl, purchase.labelUrl, id),
    db.prepare('UPDATE orders SET tracking_id = ? WHERE id = ?').bind(purchase.trackingNumber, order.id),
  ]);

  if (input.shopEmail) {
    await queueEmail(db, buildShippingLabelEmail({
      to: input.shopEmail, labelId: id, orderNumber: order.orderNumber, customerName: order.customerName,
      cityState: cityState(order), serviceName: SERVICE_NAMES[key], amount: rate.amount,
      trackingNumber: purchase.trackingNumber, labelUrl: purchase.labelUrl, box: order.box, weightLb: order.weightLb,
      shipDate: input.shipDate,
      items: order.items.map((i) => ({ name: i.selected_tier ? `${i.product_name} (${i.selected_tier} pcs)` : i.product_name, quantity: i.quantity })),
    }), input.queue).catch((e: unknown) => console.error(JSON.stringify({ event: 'label_email_failed', error: String(e) })));
  }
  return (await db.prepare('SELECT * FROM shipping_labels WHERE id = ?').bind(id).first<LabelRow>())!;
}

/** Void the order's unused label; Shippo refunds its cost. */
export async function voidOrderLabel(db: D1Database, apiKey: string, orderId: string): Promise<void> {
  const label = await db.prepare(`SELECT * FROM shipping_labels WHERE order_id = ? AND status = 'purchased'`).bind(orderId).first<LabelRow>();
  if (!label?.shippo_transaction_id) throw new ShippingError('There is no label to void.');
  if (label.scanned_at) throw new ShippingError('UPS has already scanned this package, so the label cannot be voided.');
  const result = await voidLabel(apiKey, label.shippo_transaction_id);
  if (!['QUEUED', 'PENDING', 'SUCCESS'].includes(result.status)) {
    await db.prepare('UPDATE shipping_labels SET error = ? WHERE id = ?').bind(`Void refused: ${result.status}`, label.id).run();
    throw new ShippingError(`Shippo did not accept the void (${result.status || 'no status'}).`, 'VOID_FAILED', 502);
  }
  await db.batch([
    db.prepare(`UPDATE shipping_labels SET status = 'voided', voided_at = datetime('now'), error = NULL WHERE id = ?`).bind(label.id),
    db.prepare('UPDATE orders SET tracking_id = NULL WHERE id = ? AND tracking_id = ?').bind(orderId, label.tracking_number),
  ]);
}

/** After checking Shippo, free an order whose purchase never completed. */
export async function releaseStuckLabel(db: D1Database, orderId: string): Promise<void> {
  const result = await db.prepare(
    `UPDATE shipping_labels SET status = 'failed', error = COALESCE(error || ' · ', '') || 'Released by the owner'
     WHERE order_id = ? AND status = 'buying'`,
  ).bind(orderId).run();
  if (!result.meta.changes) throw new ShippingError('Nothing to release for this order.');
}

/** Owner's Shippo / Pirate Ship switch (null = follow the rules). */
export async function setShipRoute(db: D1Database, orderId: string, route: ShipRoute | null): Promise<void> {
  const order = requireShippable(await loadShippingOrder(db, orderId));
  if (order.activeLabel) throw new ShippingError('Void the Shippo label before switching to Pirate Ship.');
  await db.prepare('UPDATE orders SET ship_route = ? WHERE id = ?').bind(route, order.id).run();
}
