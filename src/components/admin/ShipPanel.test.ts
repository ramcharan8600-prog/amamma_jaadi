// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ShipPanel from './ShipPanel';

const baseOrder = {
  id: 'o1', orderNumber: 'AJ-1300', customerName: 'Priya', email: 'p@example.com', orderType: 'delivery', paymentStatus: 'paid',
  status: 'confirmed', shipmentStatus: 'yet_to_ship', trackingId: null, createdAt: '2026-10-09 15:00:00',
  addressText: '1 Main St\nDallas, TX 75201\nUSA', address: null, state: 'TX', shippingPaid: 6.99,
  items: [{ product_name: 'Guntur Malpuri', quantity: 2, selected_tier: 16 }], route: 'shippo', autoRoute: 'shippo',
  routeReason: 'Texas order', routeOverride: null, box: null, weightLb: null, pickleOnly: false, groundOnly: false, activeLabel: null, labels: [],
};
let order: Record<string, unknown>;
let posts: Array<Record<string, unknown>>;
let addressCheck: { valid: boolean | null; messages: string[] };
let host: HTMLDivElement;
let root: Root;
const rates = [
  { rateId: 'g', service: 'ground', serviceName: 'UPS Ground', amount: 7.85, currency: 'USD', estimatedDays: 1, arrivesOn: '2026-10-13', margin: -0.86, recommended: true, overLimit: false },
  { rateId: 'a', service: 'air', serviceName: 'UPS 2nd Day Air', amount: 21.4, currency: 'USD', estimatedDays: 2, arrivesOn: '2026-10-14', margin: -14.41, recommended: false, overLimit: true },
];

beforeEach(() => {
  order = { ...baseOrder };
  posts = [];
  addressCheck = { valid: true, messages: [] };
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('confirm', vi.fn(() => true));
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      posts.push(body);
      if (body.action === 'quote') return Response.json({ shipmentId: 's1', shipDate: '2026-10-12', rates, addressCheck, messages: [] });
      if (body.action === 'buy') {
        if (body.rateId === 'a' && !body.confirmOverLimit) return Response.json({ error: 'confirm', code: 'CONFIRM_OVER_LIMIT' }, { status: 409 });
        order = { ...order, activeLabel: { id: 'l1', status: 'purchased', service_name: 'UPS Ground', amount: 7.85, tracking_number: '1Z999', label_url: 'https://shippo.test/l.pdf', ship_date: '2026-10-12', box: '9x9x6', weight_lb: 2.4, scanned_at: null } };
        return Response.json({ label: order.activeLabel });
      }
      if (body.action === 'void') { order = { ...order, activeLabel: null, labels: [{ id: 'l1', status: 'voided', service_name: 'UPS Ground', amount: 7.85 }] }; return Response.json({ ok: true }); }
      if (body.action === 'route') { order = { ...order, route: body.route ?? order.autoRoute, routeOverride: body.route }; return Response.json({ ok: true }); }
    }
    return Response.json({ order, boxes: [{ id: '9x9x6', label: '9 × 9 × 6 in' }, { id: '12x8x10', label: '12 × 8 × 10 in' }], priceLimit: 20, defaultShipDate: '2026-10-12', shippoConfigured: true });
  }));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!;
async function type(selector: string, value: string) {
  const el = host.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function render(onChanged = vi.fn()) {
  await act(async () => root.render(createElement(ShipPanel, { orderId: 'o1', onClose: vi.fn(), onChanged })));
  await act(async () => {});
  return onChanged;
}

it('quotes with box, weight and date, stars the recommendation, shows arrival and margin, and buys the label', async () => {
  const onChanged = await render();
  expect(host.textContent).toContain('Guntur Malpuri (16 pcs) × 2');
  expect(host.textContent).toContain('Customer paid $6.99 shipping');
  await type('#ship-weight', '2.4');
  await act(async () => button('Get label ETA').click());
  expect(posts[0]).toEqual({ action: 'quote', orderId: 'o1', box: '9x9x6', weightLb: 2.4, shipDate: '2026-10-12' });
  expect(host.querySelector('[aria-label="Recommended"]')).not.toBeNull();
  expect(host.textContent).toContain('Arrives Tue, Oct 13 · 1 business day');
  expect(host.textContent).toContain('vs $6.99 paid: −$0.86');

  await act(async () => button('Buy UPS Ground label').click());
  expect(posts[1]).toMatchObject({ action: 'buy', rateId: 'g', confirmOverLimit: false });
  expect(onChanged).toHaveBeenCalled();
  expect(host.textContent).toContain('Tracking: 1Z999');
  expect(host.querySelector<HTMLAnchorElement>('a[href="https://shippo.test/l.pdf"]')?.textContent).toContain('Download label (PDF)');
});

it('stops label buying when UPS/USPS cannot confirm the address, or the check gives no answer', async () => {
  await render();
  await type('#ship-weight', '2.4');
  addressCheck = { valid: false, messages: ['Street not found.'] };
  await act(async () => button('Get label ETA').click());
  expect(host.textContent).toContain('Stop: UPS/USPS could not confirm this address. Street not found. No label can be bought');
  expect(button('Buy UPS Ground label').disabled).toBe(true);
  expect(button('Buy UPS 2nd Day Air label').disabled).toBe(true);

  addressCheck = { valid: null, messages: ['Address check unavailable: timeout'] };
  await act(async () => button('Get label ETA').click());
  expect(host.textContent).toContain('Stop: the address check gave no clear answer.');
  expect(button('Buy UPS Ground label').disabled).toBe(true);
  expect(posts.filter((p) => p.action === 'buy')).toHaveLength(0);
});

it('asks for a second tap before buying a label over $20', async () => {
  await render();
  await type('#ship-weight', '2.4');
  await act(async () => button('Get label ETA').click());
  await act(async () => button('Buy UPS 2nd Day Air label').click());
  expect(posts.filter((p) => p.action === 'buy')).toHaveLength(0);
  expect(host.textContent).toContain('over $20.00. Tap Buy again to confirm');
  await act(async () => button('Confirm: buy for $21.40').click());
  expect(posts.at(-1)).toMatchObject({ action: 'buy', rateId: 'a', confirmOverLimit: true });
});

it('voids a label after confirming, and switches an order to Pirate Ship', async () => {
  order = { ...baseOrder, activeLabel: { id: 'l1', status: 'purchased', service_name: 'UPS Ground', amount: 7.85, tracking_number: '1Z999', label_url: 'https://shippo.test/l.pdf', ship_date: '2026-10-12', box: '9x9x6', weight_lb: 2.4, scanned_at: null } };
  await render();
  expect(button('Pirate Ship (by hand)').disabled).toBe(true); // void first
  await act(async () => button('Void label').click());
  expect(window.confirm).toHaveBeenCalled();
  expect(posts.at(-1)).toEqual({ action: 'void', orderId: 'o1' });
  expect(host.textContent).toContain('Voided · UPS Ground · $7.85');

  await act(async () => button('Pirate Ship (by hand)').click());
  expect(posts.at(-1)).toEqual({ action: 'route', orderId: 'o1', route: 'pirate_ship' });
  expect(host.textContent).toContain('Ship this order on Pirate Ship');
  expect(host.querySelector('#ship-weight')).toBeNull();
});
