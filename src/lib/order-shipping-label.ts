import { deliveryService, groundShippingKind, shippingMethodLabel, type DeliveryService } from '@/lib/pricing';
import { lineProduct } from '@/lib/production';
import { stateFromAddress } from '@/lib/ship-routing';
import type { OrderRecord } from '@/types';

const ADMIN_SERVICE_LABELS: Record<DeliveryService, string> = {
  texas: 'Texas · about 1 business day',
  standard: 'Ground rate (customer sees "Express shipping")',
  express: 'Express · 2-day',
  'second-day-air': 'UPS 2nd Day Air',
};

/**
 * Admin: the shipping service a delivery order was sold with — worked out from its
 * state and items exactly as checkout did (deliveryService), not the stored method,
 * which is "standard" for nearly every order. Orders saved with a legacy method
 * (expedited / ground) keep its wording.
 */
export function orderShippingLabel(order: Pick<OrderRecord, 'delivery_address' | 'shipping_method' | 'order_items'>): string {
  if (order.shipping_method === 'expedited' || order.shipping_method === 'ground') return shippingMethodLabel(order.shipping_method);
  const products = (order.order_items ?? []).map((item) => ({ product: lineProduct(item.product_name).product, quantity: item.quantity }));
  // An unknown (renamed or retired) product never counts as a cheaper ground-rate item.
  const lines = products.map(({ product, quantity }) => ({ productId: product?.id ?? 'unknown', quantity }));
  const picklesOnly = products.length > 0 && products.every(({ product }) => product?.category === 'pickles');
  return ADMIN_SERVICE_LABELS[deliveryService(stateFromAddress(order.delivery_address), picklesOnly, groundShippingKind(lines))];
}
