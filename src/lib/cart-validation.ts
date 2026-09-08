import { PRODUCTS, isProductTaxExempt } from '@/data/products';
import type { CartItem } from '@/types';

export const MAX_CART_LINES = 50;
/** A generous safety ceiling, aggregated across tiers/variants of a product. */
export const MAX_PRODUCT_QUANTITY = 1_000;

export type CartValidationResult =
  | {
      ok: true;
      items: CartItem[];
      subtotal: number;
      taxableSubtotal: number;
      requestedByProduct: Map<string, number>;
    }
  | { ok: false; error: string; status: 400 | 409 };

/**
 * Validate a new checkout against the current catalog before doing any money
 * math. Client product snapshots and prices are never copied into the session.
 * Already-paid historical sessions must not be repriced with this helper.
 */
export function validateCart(input: unknown): CartValidationResult {
  const invalid = (error: string, status: 400 | 409 = 400): CartValidationResult =>
    ({ ok: false, error, status });

  if (!Array.isArray(input) || input.length === 0) return invalid('Cart is empty');
  if (input.length > MAX_CART_LINES) return invalid('Too many items in cart.');

  const items: CartItem[] = [];
  const requestedByProduct = new Map<string, number>();
  let subtotalCents = 0;
  let taxableCents = 0;

  for (const candidate of input) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return invalid('Invalid cart item.');
    }
    const raw = candidate as Record<string, unknown>;
    if (typeof raw.productId !== 'string') return invalid('Invalid product.');
    const product = PRODUCTS.find(({ id }) => id === raw.productId);
    if (!product) return invalid('Unknown product.');
    if (!product.inStock) return invalid(`${product.name} is currently out of stock.`, 409);

    const quantity = raw.quantity;
    if (
      typeof quantity !== 'number' ||
      !Number.isSafeInteger(quantity) ||
      quantity <= 0 ||
      quantity > MAX_PRODUCT_QUANTITY
    ) {
      return invalid(`Please enter a whole-number quantity from 1 to ${MAX_PRODUCT_QUANTITY} for ${product.name}.`);
    }
    const productQuantity = (requestedByProduct.get(product.id) ?? 0) + quantity;
    if (productQuantity > MAX_PRODUCT_QUANTITY) {
      return invalid(`The maximum quantity for ${product.name} is ${MAX_PRODUCT_QUANTITY}.`);
    }
    requestedByProduct.set(product.id, productQuantity);

    let selectedTier: number | undefined;
    if (product.category === 'sweets') {
      if (
        typeof raw.selectedTier !== 'number' ||
        !Number.isSafeInteger(raw.selectedTier) ||
        !product.quantityOptions?.includes(raw.selectedTier)
      ) {
        return invalid(`Invalid quantity option for ${product.name}`);
      }
      selectedTier = raw.selectedTier;
    } else if (raw.selectedTier != null) {
      return invalid(`Invalid quantity option for ${product.name}`);
    }

    let selectedVariant: string | undefined;
    if (product.variantOptions?.length) {
      if (
        typeof raw.selectedVariant !== 'string' ||
        !product.variantOptions.includes(raw.selectedVariant)
      ) {
        return invalid(`Please choose the contents for ${product.name}.`);
      }
      selectedVariant = raw.selectedVariant;
    } else if (raw.selectedVariant != null) {
      return invalid(`Invalid contents option for ${product.name}.`);
    }

    const unitCents = Math.round(product.unitPrice * 100);
    const lineCents = unitCents * (selectedTier ?? 1) * quantity;
    if (
      !Number.isFinite(product.unitPrice) ||
      !Number.isSafeInteger(unitCents) ||
      unitCents <= 0 ||
      !Number.isSafeInteger(lineCents) ||
      lineCents <= 0 ||
      !Number.isSafeInteger(subtotalCents + lineCents)
    ) {
      return invalid('Invalid order total');
    }
    subtotalCents += lineCents;
    if (!isProductTaxExempt(product)) taxableCents += lineCents;

    items.push({
      productId: product.id,
      product: { ...product },
      quantity,
      ...(selectedTier === undefined ? {} : { selectedTier }),
      ...(selectedVariant === undefined ? {} : { selectedVariant }),
      lineTotal: lineCents / 100,
    });
  }

  return {
    ok: true,
    items,
    subtotal: subtotalCents / 100,
    taxableSubtotal: taxableCents / 100,
    requestedByProduct,
  };
}
