import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestD1 } from '@/lib/test-utils/d1';
import { toBusinessDateString } from '@/lib/date';

const shippo = vi.hoisted(() => ({
  validateAddress: vi.fn(),
  createShipment: vi.fn(),
  getRate: vi.fn(),
  buyLabel: vi.fn(),
  voidLabel: vi.fn(),
}));
vi.mock('@/lib/shippo', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/shippo')>(), ...shippo }));
vi.mock('@/lib/email-outbox', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/email-outbox')>(),
  publishPersistedEmail: vi.fn(async () => true),
}));
import {
  addBusinessDays, defaultShipDate, loadShippingOrder, parseBox, purchaseLabel, quoteLabel, rateOptions, relevantShippoMessages,
  releaseStuckLabel, setShipRoute, voidOrderLabel,
} from './shipping-labels';
import { ShippoError } from './shippo';

let fixture: ReturnType<typeof createTestD1>;
const today = toBusinessDateString(new Date());

function addOrder(id: string, fields: Record<string, unknown> = {}, items: Array<[string, number, number | null]> = [['Guntur Malpuri', 1, 16]]) {
  const row = {
    order_number: `AJ-${id}`, customer_name: 'Test Buyer', phone_number: '2145550100', email: 'buyer@example.com',
    order_type: 'delivery', delivery_address: '100 Main St\nDallas, TX 75201\nUSA', total_price: 46.99, tax: 0,
    payment_status: 'paid', status: 'confirmed', ...fields,
  };
  fixture.sqlite.prepare(`INSERT INTO orders (id, ${Object.keys(row).join(', ')}) VALUES (?, ${Object.keys(row).map(() => '?').join(', ')})`)
    .run(id, ...Object.values(row));
  items.forEach(([name, qty, tier], i) => fixture.sqlite.prepare(
    'INSERT INTO order_items (id, order_id, product_name, quantity, product_price, selected_tier, line_total) VALUES (?,?,?,?,0,?,0)',
  ).run(`${id}-${i}`, id, name, qty, tier));
  // The paid checkout session that holds the structured address and the shipping paid.
  fixture.sqlite.prepare(`INSERT INTO payment_sessions (id, customer_name, email, phone_number, cart_data, fulfillment_data, total_amount, shipping, idempotency_key)
    VALUES (?, 'Test Buyer', 'buyer@example.com', '2145550100', '[]', ?, 46.99, 6.99, ?)`)
    .run(`ps-${id}`, JSON.stringify({ type: 'delivery', customerName: 'Test Buyer', addressLine1: '100 Main St', addressLine2: 'Apt 4',
      city: 'Dallas', state: 'TX', zip: '75201', country: 'USA', phone: '2145550100', email: 'buyer@example.com' }), `key-${id}`);
  fixture.sqlite.prepare(`INSERT INTO order_finalizations (order_id, payment_session_id, attempt_id, legacy_repair) VALUES (?, ?, ?, 0)`)
    .run(id, `ps-${id}`, `att-${id}`);
}

const rate = (rateId: string, token: string, name: string, amount: number, days: number) =>
  ({ rateId, provider: 'UPS', serviceToken: token, serviceName: name, amount, currency: 'USD', estimatedDays: days, durationTerms: null });

beforeEach(() => {
  fixture = createTestD1();
  fixture.sqlite.exec(readFileSync(new URL('./d1-schema.sql', import.meta.url), 'utf8'));
  for (const fn of Object.values(shippo)) fn.mockReset();
  shippo.validateAddress.mockResolvedValue({ valid: true, messages: [] });
  shippo.createShipment.mockResolvedValue({
    shipmentId: 'shp_1', messages: [],
    rates: [rate('r_ground', 'ups_ground', 'Ground', 7.85, 2), rate('r_air', 'ups_second_day_air', '2nd Day Air', 14.2, 2),
      rate('r_next', 'ups_next_day_air', 'Next Day Air', 40, 1), rate('r_usps', 'usps_priority', 'Priority', 9, 2)],
  });
  shippo.getRate.mockImplementation(async (_key: string, id: string) => ({
    r_ground: { amount: 7.85, currency: 'USD', provider: 'UPS', serviceToken: 'ups_ground', serviceName: 'Ground', shipmentId: 'shp_1' },
    r_air: { amount: 24.5, currency: 'USD', provider: 'UPS', serviceToken: 'ups_second_day_air', serviceName: '2nd Day Air', shipmentId: 'shp_1' },
    r_usps: { amount: 9, currency: 'USD', provider: 'USPS', serviceToken: 'usps_priority', serviceName: 'Priority', shipmentId: 'shp_1' },
  } as Record<string, unknown>)[id]);
  shippo.buyLabel.mockResolvedValue({
    transactionId: 'tx_1', status: 'SUCCESS', trackingNumber: '1Z999', trackingUrl: 'https://ups.test/1Z999', labelUrl: 'https://shippo.test/label.pdf', messages: [],
  });
  shippo.voidLabel.mockResolvedValue({ status: 'QUEUED' });
});
afterEach(() => fixture.sqlite.close());

describe('helpers', () => {
  it('parses the shop boxes and Other sizes', () => {
    expect(parseBox('9x9x6')).toEqual({ length: 9, width: 9, height: 6 });
    expect(parseBox('11x7.5x5.5')).toEqual({ length: 11, width: 7.5, height: 5.5 });
    expect(parseBox('12 x 10 x 4')).toEqual({ length: 12, width: 10, height: 4 });
    for (const bad of ['9x9', '0x9x6', 'big', null]) expect(parseBox(bad)).toBeNull();
  });

  it('counts business days and picks a sensible ship date', () => {
    expect(addBusinessDays('2026-10-09', 1)).toBe('2026-10-12'); // Fri + 1 → Mon
    expect(addBusinessDays('2026-10-12', 2)).toBe('2026-10-14');
    expect(defaultShipDate(new Date('2026-10-12T15:00:00Z'))).toBe('2026-10-12'); // Mon 10 AM Dallas
    expect(defaultShipDate(new Date('2026-10-12T23:30:00Z'))).toBe('2026-10-13'); // Mon 6:30 PM → Tue
    expect(defaultShipDate(new Date('2026-10-10T15:00:00Z'))).toBe('2026-10-12'); // Sat → Mon
  });

  it('offers Ground and 2nd Day Air only, stars the cheapest that arrives as fast as Air, and shows the margin', () => {
    const options = rateOptions([
      rate('g', 'ups_ground', 'Ground', 7.85, 2), rate('a', 'ups_second_day_air', '2nd Day Air', 14.2, 2), rate('n', 'ups_next_day_air', 'Next Day', 40, 1),
    ], { pickleOnly: false, shipDate: '2026-10-12', shippingPaid: 10.99 });
    expect(options.map((o) => [o.serviceName, o.arrivesOn, o.margin, o.recommended])).toEqual([
      ['UPS Ground', '2026-10-14', 3.14, true],
      ['UPS 2nd Day Air', '2026-10-14', -3.21, false],
    ]);
    // Ground is slower than Air → Air is the recommendation.
    const slow = rateOptions([rate('g', 'ups_ground', 'Ground', 9, 4), rate('a', 'ups_second_day_air', '2nd Day Air', 21, 2)],
      { pickleOnly: false, shipDate: '2026-10-12', shippingPaid: null });
    expect(slow.find((o) => o.recommended)?.service).toBe('air');
    expect(slow.find((o) => o.service === 'air')?.overLimit).toBe(true);
  });

  it("keeps only Shippo notes that matter for a UPS label", () => {
    expect(relevantShippoMessages([
      "Carrier account shippo_dpd_de_account doesn't support one or more shipment options",
      'Hard: Too Many Requests', 'Hard: Too Many Requests',
      'Shipment origin is out of service area for UPS Master account from CA',
      'RatedShipmentAlert: Your invoice may vary from the displayed reference rates',
      'Your account is restricted from using this carrier.',
      "Shippo's DHL Express master account doesn't support shipments to inside of the US",
    ])).toEqual(['Too Many Requests', 'Your account is restricted from using this carrier.']);
  });

  it('warns when the box would spend a weekend with UPS', () => {
    // Thursday + 2 business days = Monday: Saturday and Sunday in a truck.
    const thu = rateOptions([rate('g', 'ups_ground', 'Ground', 7.85, 2), rate('a', 'ups_second_day_air', '2nd Day Air', 14.2, 1)],
      { pickleOnly: false, shipDate: '2026-10-15', shippingPaid: 10.99 });
    expect(thu.map((o) => [o.service, o.arrivesOn, o.overWeekend])).toEqual([['ground', '2026-10-19', true], ['air', '2026-10-16', false]]);
    // Monday + 2 = Wednesday: no weekend.
    expect(rateOptions([rate('g', 'ups_ground', 'Ground', 7.85, 2)], { pickleOnly: false, shipDate: '2026-10-12', shippingPaid: null })[0].overWeekend).toBe(false);
  });

  it('gives pickle-only orders Ground Saver, or Ground when Ground Saver is not offered', () => {
    const saver = rateOptions([rate('s', 'ups_ground_saver', 'Ground Saver', 6.2, 4), rate('g', 'ups_ground', 'Ground', 7.5, 3)],
      { pickleOnly: true, shipDate: '2026-10-12', shippingPaid: 6.99 });
    expect(saver.map((o) => o.serviceName)).toEqual(['UPS Ground Saver']);
    const ground = rateOptions([rate('g', 'ups_ground', 'Ground', 7.5, 3)], { pickleOnly: true, shipDate: '2026-10-12', shippingPaid: 6.99 });
    expect(ground.map((o) => o.serviceName)).toEqual(['UPS Ground']);
  });

  it('gives Malai Khaja orders UPS Ground even when Ground is slower than 2nd Day Air', () => {
    const rates = [rate('g', 'ups_ground', 'Ground', 9, 4), rate('a', 'ups_second_day_air', '2nd Day Air', 21, 2)];
    const options = rateOptions(rates, { pickleOnly: false, groundOnly: true, shipDate: '2026-10-12', shippingPaid: 10.99 });
    expect(options.map((o) => [o.serviceName, o.recommended])).toEqual([['UPS Ground', true]]);
    const noGround = rateOptions([rate('a', 'ups_second_day_air', '2nd Day Air', 21, 2)],
      { pickleOnly: false, groundOnly: true, shipDate: '2026-10-12', shippingPaid: 10.99 });
    expect(noGround.map((o) => o.serviceName)).toEqual(['UPS 2nd Day Air']);
  });
});

describe('label workflow', () => {
  it('reads the structured address, route and what the customer paid for shipping', async () => {
    addOrder('1');
    const order = (await loadShippingOrder(fixture.db, '1'))!;
    expect(order.address).toMatchObject({ street1: '100 Main St', street2: 'Apt 4', city: 'Dallas', state: 'TX', zip: '75201', country: 'US' });
    expect(order).toMatchObject({ route: 'shippo', shippingPaid: 6.99, activeLabel: null });
  });

  it('quotes with the box, weight and AJ number, and remembers the box and weight', async () => {
    addOrder('1');
    const quote = await quoteLabel(fixture.db, 'key', { orderId: '1', box: '9x9x6', weightLb: 2.4, shipDate: today });
    expect(shippo.createShipment).toHaveBeenCalledWith('key', expect.objectContaining({
      parcel: { length: 9, width: 9, height: 6, weightLb: 2.4 }, reference: 'AJ-1', shipDate: today,
    }));
    expect(quote.rates.map((r) => r.serviceName)).toEqual(['UPS Ground', 'UPS 2nd Day Air']);
    expect(fixture.sqlite.prepare('SELECT ship_box, ship_weight_lb FROM orders').get()).toEqual({ ship_box: '9x9x6', ship_weight_lb: 2.4 });
  });

  it('buys one label, saves tracking on the order, emails the shop, and refuses a second purchase', async () => {
    addOrder('1');
    await quoteLabel(fixture.db, 'key', { orderId: '1', box: '9x9x6', weightLb: 2.4, shipDate: today });
    const label = await purchaseLabel(fixture.db, 'key', { orderId: '1', rateId: 'r_ground', shipDate: today, shopEmail: 'shop@example.com' });
    expect(label).toMatchObject({ status: 'purchased', service_name: 'UPS Ground', amount: 7.85, tracking_number: '1Z999', label_url: 'https://shippo.test/label.pdf' });
    expect(shippo.buyLabel).toHaveBeenCalledWith('key', 'r_ground', 'AJ-1');
    expect(fixture.sqlite.prepare('SELECT tracking_id FROM orders').get()?.tracking_id).toBe('1Z999');
    const email = fixture.sqlite.prepare('SELECT to_json, subject, dedupe_key FROM email_outbox').get() as Record<string, string>;
    expect(email).toMatchObject({ to_json: '["shop@example.com"]', subject: 'AJ-1 · UPS Ground · Dallas, TX', dedupe_key: `shipping-label:${label.id}` });

    await expect(purchaseLabel(fixture.db, 'key', { orderId: '1', rateId: 'r_ground', shipDate: today, shopEmail: null }))
      .rejects.toMatchObject({ code: 'ALREADY_LABELED' });
    expect(shippo.buyLabel).toHaveBeenCalledTimes(1);
  });

  it('needs confirmation above $20 and refuses non-UPS rates, using Shippo prices not the browser', async () => {
    addOrder('1');
    await quoteLabel(fixture.db, 'key', { orderId: '1', box: '9x9x6', weightLb: 2.4, shipDate: today });
    await expect(purchaseLabel(fixture.db, 'key', { orderId: '1', rateId: 'r_air', shipDate: today, shopEmail: null }))
      .rejects.toMatchObject({ code: 'CONFIRM_OVER_LIMIT' });
    await expect(purchaseLabel(fixture.db, 'key', { orderId: '1', rateId: 'r_usps', shipDate: today, shopEmail: null }))
      .rejects.toThrow(/Only UPS/);
    expect(shippo.buyLabel).not.toHaveBeenCalled();
    const label = await purchaseLabel(fixture.db, 'key', { orderId: '1', rateId: 'r_air', confirmOverLimit: true, shipDate: today, shopEmail: null });
    expect(label.amount).toBe(24.5);
  });

  it('buys no label unless UPS/USPS confirms the address (checked again at purchase)', async () => {
    addOrder('1');
    await quoteLabel(fixture.db, 'key', { orderId: '1', box: '9x9x6', weightLb: 2.4, shipDate: today });
    const buy = () => purchaseLabel(fixture.db, 'key', { orderId: '1', rateId: 'r_ground', shipDate: today, shopEmail: null });
    shippo.validateAddress.mockResolvedValueOnce({ valid: false, messages: ['Street not found.'] });
    await expect(buy()).rejects.toMatchObject({ code: 'ADDRESS_NOT_CONFIRMED', message: expect.stringContaining('Street not found.') });
    shippo.validateAddress.mockResolvedValueOnce({ valid: null, messages: [] });
    await expect(buy()).rejects.toMatchObject({ code: 'ADDRESS_NOT_CONFIRMED' });
    shippo.validateAddress.mockRejectedValueOnce(new ShippoError('Could not reach Shippo: timeout'));
    await expect(buy()).rejects.toMatchObject({ code: 'ADDRESS_NOT_CONFIRMED' });
    expect(shippo.buyLabel).not.toHaveBeenCalled();
    expect((await loadShippingOrder(fixture.db, '1'))!.labels).toEqual([]);
    await expect(buy()).resolves.toMatchObject({ status: 'purchased' });
  });

  it('keeps an unconfirmed purchase locked (never buys twice) until the owner releases it', async () => {
    addOrder('1');
    await quoteLabel(fixture.db, 'key', { orderId: '1', box: '9x9x6', weightLb: 2.4, shipDate: today });
    shippo.buyLabel.mockRejectedValueOnce(new ShippoError('Could not reach Shippo: timeout'));
    await expect(purchaseLabel(fixture.db, 'key', { orderId: '1', rateId: 'r_ground', shipDate: today, shopEmail: null }))
      .rejects.toMatchObject({ code: 'UNCONFIRMED' });
    expect((await loadShippingOrder(fixture.db, '1'))!.activeLabel?.status).toBe('buying');
    await expect(purchaseLabel(fixture.db, 'key', { orderId: '1', rateId: 'r_ground', shipDate: today, shopEmail: null }))
      .rejects.toMatchObject({ code: 'ALREADY_LABELED' });
    await releaseStuckLabel(fixture.db, '1');
    expect((await loadShippingOrder(fixture.db, '1'))!.activeLabel).toBeNull();
  });

  it('frees the order when Shippo definitely refuses the label', async () => {
    addOrder('1');
    await quoteLabel(fixture.db, 'key', { orderId: '1', box: '9x9x6', weightLb: 2.4, shipDate: today });
    shippo.buyLabel.mockResolvedValueOnce({ transactionId: 'tx_bad', status: 'ERROR', trackingNumber: null, trackingUrl: null, labelUrl: null, messages: ['Address invalid'] });
    await expect(purchaseLabel(fixture.db, 'key', { orderId: '1', rateId: 'r_ground', shipDate: today, shopEmail: null }))
      .rejects.toThrow(/Address invalid/);
    expect((await loadShippingOrder(fixture.db, '1'))!.activeLabel).toBeNull();
  });

  it('voids an unscanned label, clears the tracking number, and lets the order be labelled again', async () => {
    addOrder('1');
    await quoteLabel(fixture.db, 'key', { orderId: '1', box: '9x9x6', weightLb: 2.4, shipDate: today });
    await purchaseLabel(fixture.db, 'key', { orderId: '1', rateId: 'r_ground', shipDate: today, shopEmail: null });
    await voidOrderLabel(fixture.db, 'key', '1');
    expect(shippo.voidLabel).toHaveBeenCalledWith('key', 'tx_1');
    const order = (await loadShippingOrder(fixture.db, '1'))!;
    expect(order.activeLabel).toBeNull();
    expect(order.labels[0]).toMatchObject({ status: 'voided' });
    expect(order.trackingId).toBeNull();
  });

  it('refuses refunded, pickup, shipped and Pirate Ship orders', async () => {
    addOrder('refunded', { payment_status: 'refunded' });
    addOrder('pickup', { order_type: 'pickup', delivery_address: null });
    addOrder('shipped', { shipment_status: 'shipped' });
    addOrder('far', { delivery_address: '1 Way\nNew York, NY 10001\nUSA' });
    fixture.sqlite.prepare("UPDATE payment_sessions SET fulfillment_data = json_set(fulfillment_data, '$.state', 'NY') WHERE id = 'ps-far'").run();
    for (const id of ['refunded', 'pickup', 'shipped', 'far']) {
      await expect(quoteLabel(fixture.db, 'key', { orderId: id, box: '9x9x6', weightLb: 2, shipDate: today })).rejects.toThrow();
    }
    // The owner can switch the far order to Shippo, then quote it.
    await setShipRoute(fixture.db, 'far', 'shippo');
    await expect(quoteLabel(fixture.db, 'key', { orderId: 'far', box: '9x9x6', weightLb: 2, shipDate: today })).resolves.toBeTruthy();
  });
});
