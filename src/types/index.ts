// ============================================================
// Amamma Jaadi — Core Type Definitions
// ============================================================

export type ProductCategory = 'pickles' | 'sweets' | 'gift-boxes';

export interface Product {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: ProductCategory;
  unitPrice: number;
  image: string;
  /** Override the card image fit. Defaults to 'cover' (fills/crops). 'contain' shows the whole image. */
  imageFit?: 'cover' | 'contain';
  /** For pickles: fixed size label */
  sizeLabel?: string;
  /** For sweets: available quantity tiers */
  quantityOptions?: number[];
  /** For pickles: fixed jar quantity (always 1) */
  isFixedQuantity?: boolean;
  /** Square catalog ID for future integration */
  squareCatalogId?: string;
  inStock: boolean;
  tags: string[];
}

export interface CartItem {
  productId: string;
  product: Product;
  quantity: number;
  /** For sweets: selected tier (16, 25, 50) */
  selectedTier?: number;
  /** Computed line total */
  lineTotal: number;
}

export type FulfillmentType = 'pickup' | 'delivery';

export interface PickupLocation {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

export interface PickupDetails {
  type: 'pickup';
  date: string;
  locationId: string;
  customerName: string;
  phone: string;
  email: string;
}

export interface DeliveryDetails {
  type: 'delivery';
  customerName: string;
  phone: string;
  email: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  /** Google-normalized address, attached once validation succeeds. */
  normalized?: NormalizedAddress;
}

// ── Address validation ──────────────────────────────────────
/** A USPS/Google-normalized US delivery address. */
export interface NormalizedAddress {
  /** Single-line, display-ready formatted address from Google. */
  formatted: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  /** Two-letter state code. */
  state: string;
  /** ZIP or ZIP+4. */
  zip: string;
  /** ISO country code — always 'US' for accepted addresses. */
  country: string;
}

export type AddressValidationStatus =
  | 'valid'        // deliverable as entered
  | 'corrected'    // deliverable, but Google adjusted it — confirm with user
  | 'unconfirmed'  // incomplete/ambiguous — user must fix
  | 'invalid'      // rejected (non-US, PO box, undeliverable)
  | 'unavailable'; // validation service down/unconfigured

export interface AddressValidationSuccess {
  status: 'valid' | 'corrected';
  normalized: NormalizedAddress;
  /** true for 'corrected' — UI should present the suggestion for confirmation. */
  requiresConfirmation: boolean;
}

export interface AddressValidationFailure {
  status: 'unconfirmed' | 'invalid' | 'unavailable';
  message: string;
  /** Present for 'unconfirmed' to help the user correct their input. */
  normalized?: NormalizedAddress;
  /** Safe diagnostic code (no secrets) for debugging 'unavailable' causes. */
  reason?: string;
}

export type AddressValidationResult = AddressValidationSuccess | AddressValidationFailure;

/** Type guard: true when the validation result is a rejection (not deliverable). */
export function isAddressValidationFailure(
  r: AddressValidationResult
): r is AddressValidationFailure {
  return r.status === 'unconfirmed' || r.status === 'invalid' || r.status === 'unavailable';
}

/** Type guard: true when the validation result carries a usable normalized address. */
export function isAddressValidationSuccess(
  r: AddressValidationResult
): r is AddressValidationSuccess {
  return r.status === 'valid' || r.status === 'corrected';
}

export type FulfillmentDetails = PickupDetails | DeliveryDetails;

export type OrderStatus = 'pending' | 'confirmed' | 'preparing' | 'ready' | 'completed' | 'cancelled';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';

export interface Order {
  id: string;
  orderNumber: string;
  items: CartItem[];
  fulfillment: FulfillmentDetails;
  subtotal: number;
  tax: number;
  shippingFee: number;
  total: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  squarePaymentId?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Database row shapes (snake_case) — match the Supabase `orders` / `order_items`
 * tables exactly. These are the canonical shapes that admin/analytics consume,
 * unlike the camelCase `Order` domain type above (used for the cart/checkout flow).
 */
export interface OrderItemRecord {
  product_name: string;
  quantity: number;
  product_price: number;
  selected_tier: number | null;
  line_total: number;
}

export interface OrderRecord {
  id: string;
  order_number: string;
  customer_name: string;
  phone_number: string;
  email: string | null;
  order_type: FulfillmentType;
  pickup_date: string | null;
  pickup_location: string | null;
  delivery_address: string | null;
  total_price: number;
  tax?: number;
  status: string;
  payment_status: string;
  created_at: string;
  /** Present when the query joins order_items (e.g. analytics). */
  order_items?: OrderItemRecord[] | null;
}

export interface EventInquiry {
  id: string;
  eventType: string;
  sweetSelection: string[];
  quantity: number;
  deliveryAddress: string;
  phone: string;
  eventDate: string;
  status: 'pending' | 'confirmed' | 'completed';
  createdAt: string;
}

export interface ProductionRequirement {
  productId: string;
  productName: string;
  totalQuantity: number;
  unit: string;
}

export interface SalesMetric {
  date: string;
  revenue: number;
  orders: number;
}

export interface ProductSalesData {
  productId: string;
  productName: string;
  totalSold: number;
  revenue: number;
  trend: 'up' | 'down' | 'stable';
}
