import type { Metadata } from 'next';
import { plainDescription } from '@/lib/description';
import { BRAND_NAME, SITE_URL, PHONE_E164 } from '@/lib/constants';
import { ALL_SERVICE_AREAS } from '@/data/service-areas';
import { FAQS } from '@/data/faq';
import { ACTIVE_PICKUP_LOCATIONS } from '@/data/products';
import type { PickupLocation } from '@/types';
import { isPickupClosedDate } from '@/lib/pickup-date';

const DEFAULT_DESCRIPTION = 'Authentic South Indian sweets and pickles made fresh in Dallas, TX. Bobbatlu, Malai Khaja, Kova, Guntur Malpuri & more, with DFW pickup and shipping across the contiguous United States.';

export function createMetadata(params: {
  title: string;
  description?: string;
  path?: string;
  keywords?: string[];
}): Metadata {
  const title = `${params.title} | ${BRAND_NAME}`;
  const description = params.description || DEFAULT_DESCRIPTION;
  const url = `${SITE_URL}${params.path || ''}`;

  return {
    title,
    description,
    keywords: [
      'South Indian sweets Dallas',
      'Authentic Indian sweets Texas',
      'Telugu sweets Texas',
      'Andhra sweets Dallas',
      'Fresh Bobbatlu Dallas',
      'Indian sweets delivery Texas',
      'Indian sweets delivery USA',
      'Indian pickles Dallas',
      ...(params.keywords || []),
    ],
    openGraph: {
      title,
      description,
      url,
      siteName: BRAND_NAME,
      locale: 'en_US',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
    alternates: {
      canonical: url,
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}

/** The picture every page shares with (WhatsApp, Instagram, iMessage, X): the logo. */
export const SHARE_IMAGE = { url: '/images/brand/logo.png', width: 360, height: 354, alt: 'Amamma Jaadi logo' };

/**
 * Link-preview tags for one page. A page's `openGraph`/`twitter` replace the
 * root layout's wholesale, so the shared fields and the image are repeated here.
 * The logo is square, so X gets the small `summary` card (a large card would
 * crop it).
 */
export function pageShareMetadata(params: { path: string; title: string; description: string }): Pick<Metadata, 'openGraph' | 'twitter'> {
  const { title, description } = params;
  return {
    openGraph: {
      type: 'website',
      locale: 'en_US',
      siteName: BRAND_NAME,
      url: `${SITE_URL}${params.path}`,
      title,
      description,
      images: [SHARE_IMAGE],
    },
    twitter: { card: 'summary', title, description, images: [SHARE_IMAGE.url] },
  };
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** Days pickup is open, from the checkout calendar's rule (2026-10-04 was a Sunday). */
const PICKUP_OPEN_DAYS = WEEKDAYS.filter((_, day) => !isPickupClosedDate(`2026-10-${String(4 + day).padStart(2, '0')}`));

/** "6:30 PM" → "18:30"; "12:50 AM" → "00:50". */
export function to24Hour(time: string): string {
  const match = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(time);
  if (!match) throw new Error(`Unrecognised pickup time: ${time}`);
  const hour = (Number(match[1]) % 12) + (match[3] === 'PM' ? 12 : 0);
  return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

function pickupHoursSchema(from: string, until: string) {
  // A closing time before the opening time means after midnight, which Google reads correctly.
  return { '@type': 'OpeningHoursSpecification', dayOfWeek: PICKUP_OPEN_DAYS, opens: from, closes: until };
}

/** Minutes after the 6 PM day start, so 1:30 AM sorts after 10:25 PM. */
const lateness = (time24: string) => (Number(time24.slice(0, 2)) * 60 + Number(time24.slice(3)) + 6 * 60) % (24 * 60);

/** The business is open from the earliest pickup opening to the latest pickup closing. */
function businessHoursSchema(locations: readonly Pick<PickupLocation, 'pickupHours'>[]) {
  const opens = locations.map((l) => to24Hour(l.pickupHours.from)).sort((a, b) => lateness(a) - lateness(b))[0];
  const closes = locations.map((l) => to24Hour(l.pickupHours.until)).sort((a, b) => lateness(b) - lateness(a))[0];
  return pickupHoursSchema(opens, closes);
}

export function getLocalBusinessSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'FoodEstablishment',
    name: BRAND_NAME,
    description: DEFAULT_DESCRIPTION,
    url: SITE_URL,
    telephone: PHONE_E164,
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Dallas',
      addressRegion: 'TX',
      addressCountry: 'US',
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: '32.7767',
      longitude: '-96.7970',
    },
    // Every city we actually serve — mirrors the About page so the claim on
    // the page and the claim in the markup can never disagree.
    areaServed: ALL_SERVICE_AREAS.map((city) => ({
      '@type': 'City',
      name: city,
      addressRegion: 'TX',
      addressCountry: 'US',
    })),
    // Real, visitable collection points. Helps Google associate the business
    // with those neighbourhoods rather than just "Dallas".
    hasPOS: ACTIVE_PICKUP_LOCATIONS.map((loc) => ({
      '@type': 'Place',
      name: loc.name,
      openingHoursSpecification: pickupHoursSchema(to24Hour(loc.pickupHours.from), to24Hour(loc.pickupHours.until)),
      address: {
        '@type': 'PostalAddress',
        streetAddress: loc.address,
        addressLocality: loc.city,
        addressRegion: loc.state,
        postalCode: loc.zip,
        addressCountry: 'US',
      },
    })),
    servesCuisine: ['South Indian', 'Telugu', 'Andhra', 'Indian Sweets'],
    priceRange: '$$',
    // Pickup hours: closed Tuesdays, each location's own window on hasPOS.
    openingHoursSpecification: businessHoursSchema(ACTIVE_PICKUP_LOCATIONS),
    sameAs: [
      'https://www.instagram.com/AMAMMA_JAADI',
    ],
  };
}

/**
 * FAQPage structured data, built from the same FAQS list the About page
 * renders. Eligible for FAQ rich results in Google — but ONLY because every
 * question and answer here is also visible on the page.
 */
export function getFaqSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQS.map((f) => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: f.answer },
    })),
  };
}

export function getProductListSchema(products: Array<{ name: string; unitPrice: number; tierPrices?: Partial<Record<number, number>>; quantityOptions?: number[]; image: string; description?: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: products.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'Product',
        name: p.name,
        image: `${SITE_URL}${p.image}`,
        description: p.description ? plainDescription(p.description) : `Fresh ${p.name} by ${BRAND_NAME}`,
        offers: {
          '@type': 'Offer',
          // A fixed-price box (its only size has a tier price) is listed at the box
          // price; everything else at the per-piece price.
          price: (p.tierPrices?.[p.quantityOptions?.[0] ?? -1] ?? p.unitPrice).toFixed(2),
          priceCurrency: 'USD',
          availability: 'https://schema.org/InStock',
        },
      },
    })),
  };
}
