/**
 * Test environment defaults. Set before any module loads so files that read
 * env at import time (e.g. lib/session) don't throw.
 */
process.env.SESSION_SECRET ||= 'test-session-secret-do-not-use-in-prod';
process.env.ADMIN_PASSWORD ||= 'test-admin-password';
process.env.ANALYTICS_PIN ||= '000000';
process.env.NEXT_PUBLIC_SITE_URL ||= 'http://localhost:3000';
process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ||= '15105745578';

// Temporary "sold out" box contents (e.g. a weekend without Malai Khaja) are a
// catalog setting, not a rule: tests run on the full menu. The greying itself
// is covered with its own fixture in GiftBoxCard and cart-validation tests.
import { PRODUCTS } from '@/data/products';
for (const product of PRODUCTS) delete product.unavailableVariants;
