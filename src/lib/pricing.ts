/**
 * Order pricing — the SINGLE source of truth for money math.
 *
 * Both the checkout UI (what the customer is shown) and the server
 * (`create-session`, which computes the authoritative amount actually charged)
 * import from here, so the displayed total and the charged total can never
 * drift apart.
 */

/** Texas sales tax applied to every order. */
export const SALES_TAX_RATE = 0.0825;

/** Human label for the tax line, e.g. "Sales Tax (8.25%)". */
export const SALES_TAX_LABEL = `Sales Tax (${(SALES_TAX_RATE * 100).toFixed(2).replace(/\.?0+$/, '')}%)`;

/** Round to whole cents — money must never carry float dust. */
export function roundMoney(amount: number): number {
  return Math.round((Number(amount) + Number.EPSILON) * 100) / 100;
}

export interface OrderTotals {
  subtotal: number;
  tax: number;
  total: number;
}

/**
 * Break a subtotal into subtotal + tax + total.
 * Tax is rounded to cents first, so `subtotal + tax === total` exactly.
 */
export function calculateOrderTotals(subtotal: number): OrderTotals {
  const safeSubtotal = roundMoney(Math.max(0, Number(subtotal) || 0));
  const tax = roundMoney(safeSubtotal * SALES_TAX_RATE);
  return { subtotal: safeSubtotal, tax, total: roundMoney(safeSubtotal + tax) };
}
