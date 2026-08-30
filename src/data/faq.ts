import { DFW_CITIES, WIDER_TEXAS_CITIES } from '@/data/service-areas';

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
    answer: `We deliver across the Dallas–Fort Worth metroplex, including ${DFW_CITIES.join(
      ', '
    )}. We also ship further afield in Texas to ${WIDER_TEXAS_CITIES.join(
      ', '
    )} through our courier partners. Free pickup is available at our partner locations across DFW.`,
  },
  {
    question: 'What South Indian sweets do you make?',
    answer:
      'We make traditional Andhra and Telugu sweets: Guntur Malpuri, Nellore Malai Khaja, Bobbatlu and Kova. We also make Andhra non-veg pickles — chicken, mutton and prawns — in 12oz glass jars, and gift boxes that combine our sweets.',
  },
  {
    question: 'Are your sweets freshly made?',
    answer:
      'Yes. Guntur Malpuri and Nellore Malai Khaja are baked fresh every day. Kova and Bobbatlu are baked to order, so please place those orders at least 2 days in advance. Nothing is mass produced or kept in storage.',
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
      'Delivery is free on orders of $60 and above. Below $60 a small delivery fee applies, and the exact amount is always shown before you pay. Pickup from our partner locations is always free.',
  },
  {
    question: 'Where can I pick up my order?',
    answer:
      'We have partner pickup locations across DFW in Plano, Irving, and Frisco. You choose your location at checkout, and orders can be collected between 6:30 PM and 1:30 AM.',
  },
];
