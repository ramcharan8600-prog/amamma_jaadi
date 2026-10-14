import type { CartItem, Product } from '@/types';

/**
 * Shopping funnel events for Google Analytics 4, sent through Cloudflare Zaraz
 * (injected by Cloudflare on amammajaadi.com; absent on the sandbox and in tests).
 * Only product and order facts are sent — never names, emails, phones or addresses.
 */
export type FunnelEvent =
  | 'Product Added'
  | 'Cart Viewed'
  | 'Checkout Started'
  | 'Payment Info Entered'
  | 'Order Completed';

type ZarazWindow = { zaraz?: { ecommerce?: (event: string, params: Record<string, unknown>) => unknown } };

interface FunnelProduct {
  product_id: string;
  name: string;
  category: string;
  variant?: string;
  price: number;
  quantity: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function productLine(product: Product, quantity: number, lineTotal: number, selectedTier?: number, selectedVariant?: string): FunnelProduct {
  const variant = [selectedTier ? `${selectedTier} pcs` : '', selectedVariant ?? ''].filter(Boolean).join(' · ');
  return {
    product_id: product.id,
    name: product.name,
    category: product.category,
    ...(variant ? { variant } : {}),
    price: quantity > 0 ? round(lineTotal / quantity) : 0,
    quantity,
  };
}

export function cartLines(items: CartItem[]): FunnelProduct[] {
  return items.map((i) => productLine(i.product, i.quantity, i.lineTotal, i.selectedTier, i.selectedVariant));
}

/** Fire-and-forget: analytics must never break shopping. */
export function trackFunnel(event: FunnelEvent, params: { products: FunnelProduct[]; value: number; order_id?: string; shipping?: number; tax?: number }): void {
  try {
    const zaraz = (globalThis as unknown as ZarazWindow).zaraz;
    if (typeof zaraz?.ecommerce !== 'function') return;
    zaraz.ecommerce(event, {
      ...params,
      value: round(params.value),
      ...(event === 'Order Completed' ? { revenue: round(params.value), total: round(params.value) } : {}),
      currency: 'USD',
    });
  } catch {
    // Ignore: a blocked or failing tracker must not affect the customer.
  }
}
