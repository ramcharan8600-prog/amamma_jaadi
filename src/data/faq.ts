import { DFW_CITIES } from '@/data/service-areas';

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
    answer: `Free pickup is available at our partner locations across DFW, including ${DFW_CITIES.join(
      ', '
    )}. We ship throughout Texas, the contiguous United States, and Washington, DC. Out-of-state orders are dispatched from Dallas using UPS 2nd Day Air.`,
  },
  {
    question: 'What South Indian sweets do you make?',
    answer:
      'We make traditional Andhra and Telugu sweets: Guntur Malpuri, Nellore Malai Khaja, Bobbatlu and Kova. We also make Andhra non-veg pickles — chicken, mutton and prawns — in 12oz glass jars, and gift boxes that combine our sweets.',
  },
  {
    question: 'Are your sweets freshly made?',
    answer:
      'Yes. Guntur Malpuri and Nellore Malai Khaja are baked fresh every day. Bobbatlu is available from ready stock; when your order exceeds available stock, please allow 1 day for preparation. Kova is made to order and requires at least 2 days’ notice.',
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
      'Pickle-only orders have no minimum order value. Shipping is $6.99 for one jar, $5.99 for two jars, and $4.99 for three or more jars throughout the contiguous United States and Washington, DC. Orders containing sweets, including mixed orders, follow these regional rates: $6.99 within Texas; $11.99 below $60 or $8.99 at $60 or more to Alabama, Arkansas, Colorado, Louisiana, New Mexico, and Oklahoma; and a flat $11.99 with an $80 minimum merchandise subtotal to all other contiguous states and Washington, DC. The $30 Texas Limited Edition gift box can be delivered outside Texas only as part of an order with at least a $60 merchandise subtotal. We use UPS 2nd Day Air for out-of-state orders for faster delivery from Dallas to your destination. Alaska and Hawaii require a manual quote. The exact fee is shown before payment, and pickup is always free.',
  },
  {
    question: 'Where can I pick up my order?',
    answer:
      'We have partner pickup locations across DFW in Plano, Irving, and Frisco. You choose your location at checkout, and orders can be collected between 6:30 PM and 1:30 AM.',
  },
];
