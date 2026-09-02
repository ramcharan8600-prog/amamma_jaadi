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
  /**
   * Selectable contents for a fixed-price product (gift boxes). Same price for
   * every option — only what goes in the box changes. The chosen label is
   * carried through the cart to the order, emails and the Square note so the
   * box is packed correctly.
   */
  variantOptions?: string[];
  /** Optional lead-time / freshness notice shown on the product card. */
  prepNotice?: string;
  /**
   * How to present `prepNotice`.
   * 'lead-time' (default) = amber caution, the customer must plan ahead.
   * 'fresh' = green reassurance, e.g. baked daily.
   */
  prepNoticeTone?: 'lead-time' | 'fresh';
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
  /** For gift boxes: which contents the customer chose (one of Product.variantOptions). */
  selectedVariant?: string;
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
}

export type FulfillmentDetails = PickupDetails | DeliveryDetails;

export type OrderStatus = 'pending' | 'confirmed' | 'preparing' | 'ready' | 'completed' | 'cancelled';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'partially_refunded' | 'refunded';
export type ShipmentStatus = 'yet_to_ship' | 'shipped' | 'delivered';

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
 * Database row shapes (snake_case) — match the Cloudflare D1 `orders` /
 * `order_items` tables (see src/lib/d1-schema.sql). These are the canonical
 * shapes that admin/analytics consume,
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
  refunded_amount: number;
  shipment_status: ShipmentStatus;
  tracking_id: string | null;
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
