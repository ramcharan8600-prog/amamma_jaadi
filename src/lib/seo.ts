import type { Metadata } from 'next';
import { BRAND_NAME, SITE_URL, PHONE_E164 } from '@/lib/constants';

const DEFAULT_DESCRIPTION = 'Authentic South Indian sweets and pickles made fresh in Dallas, TX. Kaju Katli, Bobbatlu, Malai Khaja, Guntur Malpuri & more. Pickup and delivery across DFW.';

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
      'Kaju Katli Dallas',
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
    servesCuisine: ['South Indian', 'Telugu', 'Andhra', 'Indian Sweets'],
    priceRange: '$$',
    openingHoursSpecification: {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
      opens: '18:30',
      closes: '01:30',
    },
    sameAs: [
      'https://www.instagram.com/AMAMMA_JAADI',
    ],
  };
}

export function getProductListSchema(products: Array<{ name: string; unitPrice: number; image: string; description?: string }>) {
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
        description: p.description || `Fresh ${p.name} by ${BRAND_NAME}`,
        offers: {
          '@type': 'Offer',
          price: p.unitPrice.toFixed(2),
          priceCurrency: 'USD',
          availability: 'https://schema.org/InStock',
        },
      },
    })),
  };
}
