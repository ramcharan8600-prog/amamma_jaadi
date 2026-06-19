/**
 * PRODUCT CATALOG (source of truth)
 *
 * The storefront and server-side price recomputation read products from this
 * file. Orders/sessions are persisted in Cloudflare D1 (see lib/d1-schema.sql),
 * but the product catalog itself is code-managed here.
 *
 * Prices here are authoritative — create-session recomputes every total from them.
 */
import { Product, PickupLocation } from '@/types';

// ============================================================
// Product Catalog — Amamma Jaadi
// ============================================================

export const PRODUCTS: Product[] = [
  // ── Pickles ──────────────────────────────────────────────
  {
    id: 'pickle-chicken',
    slug: 'chicken-pickle',
    name: 'Chicken Pickle',
    description:
      'Tender chicken pieces marinated in a fiery blend of traditional Andhra spices, slow-cooked to perfection in cold-pressed sesame oil. A bold, tangy pickle that pairs beautifully with steamed rice.',
    category: 'pickles',
    unitPrice: 14,
    image: '/images/products/Chicken Pickle.jpg',
    sizeLabel: '12oz / 354ml Glass Jar',
    isFixedQuantity: true,
    inStock: true,
    tags: ['spicy', 'non-veg', 'andhra'],
  },
  {
    id: 'pickle-mutton',
    slug: 'mutton-pickle',
    name: 'Mutton Pickle',
    description:
      'Succulent mutton pieces infused with roasted mustard, fenugreek, and red chilli in a rich sesame oil base. An heirloom recipe passed down through generations.',
    category: 'pickles',
    unitPrice: 16,
    image: '/images/products/Mutton Pickle.jpg',
    sizeLabel: '12oz / 354ml Glass Jar',
    isFixedQuantity: true,
    inStock: true,
    tags: ['spicy', 'non-veg', 'andhra'],
  },
  {
    id: 'pickle-prawns',
    slug: 'prawns-pickle',
    name: 'Prawns Pickle',
    description:
      'Fresh prawns tossed in a vibrant masala of curry leaves, garlic, and coastal spices, preserved in premium sesame oil. A taste of the Andhra coastline in every bite.',
    category: 'pickles',
    unitPrice: 16,
    image: '/images/products/Prawns pickle.jpg',
    sizeLabel: '12oz / 354ml Glass Jar',
    isFixedQuantity: true,
    inStock: true,
    tags: ['spicy', 'non-veg', 'seafood', 'andhra'],
  },

  // ── Sweets ───────────────────────────────────────────────
  {
    id: 'sweet-malpuri',
    slug: 'guntur-malpuri',
    name: 'Guntur Malpuri',
    description:
      'A signature Guntur delicacy — deep-fried discs of refined flour soaked in fragrant sugar syrup infused with cardamom. Crispy on the outside, melt-in-your-mouth inside.',
    category: 'sweets',
    unitPrice: 3,
    image: '/images/products/Guntur Malpuri.jpg',
    imageFit: 'contain',
    quantityOptions: [16, 25, 50],
    inStock: true,
    tags: ['traditional', 'andhra', 'festival'],
  },
  {
    id: 'sweet-malai-khaja',
    slug: 'nellore-malai-khaja',
    name: 'Nellore Malai Khaja',
    description:
      'Flaky, layered pastry from Nellore, delicately fried and dipped in sugar syrup. Each layer shatters into a shower of sweetness — a true South Indian masterpiece.',
    category: 'sweets',
    unitPrice: 4,
    image: '/images/products/nellore malai khaja.jpg',
    quantityOptions: [16, 25, 50],
    inStock: true,
    tags: ['traditional', 'andhra', 'festival', 'premium'],
  },
  {
    id: 'sweet-bobbatlu',
    slug: 'bobbatlu',
    name: 'Bobbatlu',
    description:
      'Thin, golden flatbreads stuffed with a sweet filling of chana dal and jaggery, cooked on a griddle with pure ghee. Amamma\'s recipe, made with patience and love.',
    category: 'sweets',
    unitPrice: 4,
    image: '/images/products/bobbatlu.jpg',
    quantityOptions: [16, 25, 50],
    inStock: true,
    tags: ['traditional', 'andhra', 'festival', 'ghee'],
  },
  {
    id: 'sweet-kova',
    slug: 'kova',
    name: 'Kova',
    description:
      'Slow-simmered A2 milk reduced to a rich, caramelised fudge. Flavoured with cardamom and garnished with slivers of pistachio. Pure indulgence, one spoonful at a time.',
    category: 'sweets',
    unitPrice: 2,
    image: '/images/products/Pala kova.png',
    quantityOptions: [16, 25, 50],
    inStock: true,
    tags: ['traditional', 'andhra', 'milk-based'],
  },
  {
    id: 'sweet-kaju-katli',
    slug: 'kaju-katli',
    name: 'Kaju Katli',
    description:
      'Diamond-shaped cashew fudge made from hand-ground premium cashews, sugar, and a touch of cardamom. Finished with a delicate layer of edible silver foil.',
    category: 'sweets',
    unitPrice: 2,
    image: '/images/products/Kaju Katli.jpeg',
    quantityOptions: [16, 25, 50],
    inStock: true,
    tags: ['premium', 'cashew', 'festival', 'gifting'],
  },

  // ── Gift Boxes ───────────────────────────────────────────
  {
    id: 'gift-box-standard',
    slug: 'premium-gift-box',
    name: 'Premium Gift Box',
    description:
      'An elegant aluminium tin filled with your choice of our finest sweets. Perfect for festivals, birthdays, celebrations, and corporate gifting. The small box holds 16 pieces.',
    category: 'gift-boxes',
    unitPrice: 50,
    image: '/images/products/gift box.png',
    isFixedQuantity: true,
    inStock: true,
    tags: ['gifting', 'premium', 'festival', 'corporate'],
  },
];

// ── Pickup Locations ────────────────────────────────────────
export const PICKUP_LOCATIONS: PickupLocation[] = [
  {
    id: 'plano-biryanify',
    name: 'Plano Biryanify',
    address: '3310 N Central Expy',
    city: 'Plano',
    state: 'TX',
    zip: '75074',
  },
  {
    id: 'irving-biryanify',
    name: 'Irving Biryanify',
    address: '7600 N MacArthur Blvd',
    city: 'Irving',
    state: 'TX',
    zip: '75063',
  },
  {
    id: 'frisco-ravibabu',
    name: 'Frisco Ravi Babu Truck',
    address: '8980 Preston Rd',
    city: 'Frisco',
    state: 'TX',
    zip: '75034',
  },
  {
    id: 'denton-ravibabu',
    name: 'Denton Ravi Babu Truck',
    address: '1288 S Loop 288',
    city: 'Denton',
    state: 'TX',
    zip: '76205',
  },
  {
    id: 'irving-ravibabu',
    name: 'Irving Ravi Babu Truck',
    address: '440 S Nursery Rd',
    city: 'Irving',
    state: 'TX',
    zip: '75060',
  },
];

// ── Helper lookups ──────────────────────────────────────────
export function getProductById(id: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === id);
}

export function getProductBySlug(slug: string): Product | undefined {
  return PRODUCTS.find((p) => p.slug === slug);
}

export function getProductsByCategory(category: string): Product[] {
  return PRODUCTS.filter((p) => p.category === category);
}

export function getPickupLocationById(id: string): PickupLocation | undefined {
  return PICKUP_LOCATIONS.find((l) => l.id === id);
}

export function calculateSweetPrice(unitPrice: number, tier: number): number {
  return unitPrice * tier;
}

/** Total pieces across all cart items (for large-order restriction) */
export function getTotalPieces(
  items: { quantity: number; selectedTier?: number; product: Product }[]
): number {
  return items.reduce((sum, item) => {
    if (item.product.category === 'sweets' && item.selectedTier) {
      return sum + item.quantity * item.selectedTier;
    }
    return sum + item.quantity;
  }, 0);
}
