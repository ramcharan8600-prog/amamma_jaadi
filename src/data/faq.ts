import { DFW_CITIES } from '@/data/service-areas';
import { ACTIVE_PICKUP_LOCATIONS } from '@/data/products';

/** "a, b and c" */
function joinList(items: readonly string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Cities with an active pickup location, from the same data checkout uses. */
const PICKUP_CITIES = joinList(Array.from(new Set(ACTIVE_PICKUP_LOCATIONS.map((l) => l.city))));
/** Each active location with its real pickup window. */
const PICKUP_WINDOWS = joinList(ACTIVE_PICKUP_LOCATIONS.map(
  (l) => `${l.name} (${l.pickupHours.from} – ${l.pickupHours.until})`));

/**
 * Frequently asked questions — the SINGLE source for both the visible About
 * page section and the FAQPage structured data. Keeping one list means Google
 * can never be shown an answer the customer doesn't see, which is exactly what
 * FAQ rich-result penalties are for.
 *
 * Answers are plain text (no markup): schema.org wants readable prose.
 */
export interface FaqItem {
  question: string;
  answer: string;
}

export const FAQS: FaqItem[] = [
  {
    question: 'Which areas do you deliver desi sweets to?',
    answer: `Customers from ${joinList([...DFW_CITIES, 'nearby cities'])} can pick up their order for free at our partner locations in ${PICKUP_CITIES}. You choose the location and date at checkout. We also ship throughout Texas, the contiguous United States and Washington, DC; the UPS service and shipping fee for your address are shown at checkout before you pay.`,
  },
  {
    question: 'What South Indian sweets do you make?',
    answer:
      'We make traditional Andhra and Telugu sweets: Guntur Malpuri, Nellore Malai Khaja, Bobbatlu, Kova Bobbatlu and Kova. We also make Andhra non-veg pickles — chicken, gongura chicken, mutton and prawns — in 12oz glass jars, and gift boxes that combine our sweets.',
  },
  {
    question: 'Are your sweets freshly made?',
    answer:
      'Yes. Guntur Malpuri and Nellore Malai Khaja are baked fresh every day. Bobbatlu and Kova Bobbatlu are available from ready stock; when your order exceeds available stock, please allow 1 day for preparation. Kova is made to order; allow 2 days for delivery preparation. Pickup orders containing Bobbatlu, Kova Bobbatlu or Kova can be scheduled from the next day. Other eligible orders offer same-day pickup when placed on or before 1:30 PM Central.',
  },
  {
    question: 'Do you cater sweets for weddings, parties and corporate events?',
    answer:
      'Yes. We supply sweets in bulk for weddings, engagements, birthdays, baby showers, housewarmings, festivals, temple events and corporate gifting across DFW. Event orders have a 100 piece minimum and need at least 2 days notice. Submit an enquiry on our Events page and we will call you back within 24 hours with pricing.',
  },
  {
    question: 'What ingredients do you use?',
    answer:
      'Pure ghee, A2 milk and organic ingredients, using recipes passed down through generations. Our pickles are made with cold-pressed sesame oil and traditional Andhra spices.',
  },
  {
    question: 'How much is delivery?',
    answer:
      'Pickle-only orders have no minimum order value. Shipping is a flat $6.99 for any number of jars throughout the contiguous United States and Washington, DC. Orders containing sweets, including mixed orders, follow these regional rates: $6.99 within Texas; $10.99 below $60, $8.99 at $60 or more, or $7.99 at $100 or more to Alabama, Arkansas, Colorado, Florida, Georgia, Illinois, Iowa, Kansas, Louisiana, Mississippi, Missouri, Nebraska, New Mexico, Oklahoma, and Tennessee; and a flat $11.99 with a $60 minimum merchandise subtotal to all other contiguous states and Washington, DC. Every Texas delivery of $120 or more ships for $3.99. The $30 Sweet Memories gift box is pickup only. The $48 Mini Combo Pack (8 Malpuri + 8 Malai Khaja) ships free within Texas ($2.99 shipping for a Texas order that also has other items) and for $3.99 to nearby states. Alaska and Hawaii require a manual quote. The exact fee is shown before payment, and pickup is always free.',
  },
  {
    question: 'Will you send me emails?',
    answer:
      'Yes, but very few. By entering your details at checkout, you agree to receive emails from Amamma Jaadi: order notifications such as your confirmation, pickup and tracking updates, plus occasional updates and promotions. We keep it to a minimum, and you can opt out of promotional emails at any time by replying to any of our emails or contacting us.',
  },
  {
    question: 'What is the $0.99 operational fee?',
    answer:
      'When a Texas delivery ships free with a Texas free-shipping coupon, we add a small $0.99 operational fee in place of shipping ($1.99 for pickle-only orders). It covers packaging, drop-off at the carrier, shipping label printing and our digital operations. The fee is always shown before payment.',
  },
  {
    question: 'Where can I pick up my order?',
    answer: `Pickup is free at our partner locations: ${PICKUP_WINDOWS}. Pickup is closed on Tuesdays. You choose the location and date at checkout, and your order confirmation shows the address and pickup window.`,
  },
];
