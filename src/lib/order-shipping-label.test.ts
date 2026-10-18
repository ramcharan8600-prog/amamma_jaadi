import { expect, it } from 'vitest';
import { orderShippingLabel } from './order-shipping-label';

const order = (address: string, names: string[], shipping_method: 'standard' | 'ground' | 'expedited' | null = 'standard') => ({
  delivery_address: address,
  shipping_method,
  order_items: names.map((product_name) => ({ product_name, quantity: 1, product_price: 0, selected_tier: null, line_total: 0 })),
});

it('shows the service each delivery was sold with, not "UPS 2nd Day Air" for everything', () => {
  expect(orderShippingLabel(order('1 Main St\nDallas, TX 75201\nUSA', ['Guntur Malpuri']))).toBe('Texas · about 1 business day');
  expect(orderShippingLabel(order('9 Way\nTulsa, OK 74103\nUSA', ['Guntur Malpuri']))).toBe('Express · 2-day');
  expect(orderShippingLabel(order('9 Way\nNew York, NY 10001\nUSA', ['Guntur Malpuri']))).toBe('UPS 2nd Day Air');
  expect(orderShippingLabel(order('9 Way\nNew York, NY 10001\nUSA', ['Assorted Box — Malpuri & Malai Khaja'])))
    .toBe('Ground rate (customer sees "Express shipping")');
  expect(orderShippingLabel(order('9 Way\nLos Angeles, CA 90001\nUSA', ['Chicken Pickle', 'Mutton Pickle'])))
    .toBe('Ground rate (customer sees "Express shipping")');
});

it('keeps a legacy method’s wording, and never guesses a cheaper rate for an unknown product', () => {
  expect(orderShippingLabel(order('9 Way\nNew York, NY 10001\nUSA', ['Guntur Malpuri'], 'ground'))).toBe('Ground — estimated 2–5 business days in transit');
  expect(orderShippingLabel(order('9 Way\nNew York, NY 10001\nUSA', ['Retired Sweet']))).toBe('UPS 2nd Day Air');
});
