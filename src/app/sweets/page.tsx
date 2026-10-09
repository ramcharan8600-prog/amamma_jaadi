import type { Metadata } from 'next';
import { getProductById, getProductsByCategory } from '@/data/products';
import SweetCard from '@/components/product/SweetCard';
import GiftBoxCard from '@/components/product/GiftBoxCard';
import JsonLd from '@/components/JsonLd';
import { getProductListSchema, pageShareMetadata } from '@/lib/seo';

export const metadata: Metadata = {
  title: 'Sweets — Freshly Baked South Indian Sweets',
  description:
    'Order fresh Bobbatlu, Kova Bobbatlu, Malai Khaja, Kova, Guntur Malpuri & Assorted Boxes. Made daily with pure ghee, A2 milk & organic ingredients. Pickup or delivery in Dallas, TX.',
  alternates: { canonical: 'https://amammajaadi.com/sweets' },
  ...pageShareMetadata({
    path: '/sweets',
    title: 'Sweets — Freshly Baked South Indian Sweets',
    description: 'Order fresh Bobbatlu, Kova Bobbatlu, Malai Khaja, Kova & Guntur Malpuri in Dallas, TX.',
  }),
};

export default function SweetsPage() {
  const sweets = getProductsByCategory('sweets');
  // The $30 Texas Limited Edition box also shows here. It is the same product as on
  // Sweets Gift Packs (same cart line, stock and pickup-only rule), not a copy.
  const pickupBox = getProductById('gift-box-sweet-memories');

  return (
    <div className="section-padding py-12 sm:py-16">
      <JsonLd data={getProductListSchema(sweets)} />
      <div className="text-center space-y-3 mb-12">
        <p className="font-body text-sm font-semibold tracking-widest text-brand-gold uppercase">
          Category
        </p>
        <h1 className="font-display text-4xl sm:text-5xl font-bold text-brand-charcoal">
          Sweets
        </h1>
        <p className="font-body text-brand-charcoal/60 max-w-lg mx-auto">
          Freshly baked every day with pure ghee, A2 milk, and organic
          ingredients — just like Amamma used to make.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
        {sweets.map((product, i) => (
          <SweetCard key={product.id} product={product} eager={i === 0} />
        ))}
        {pickupBox && <GiftBoxCard product={pickupBox} />}
      </div>
    </div>
  );
}
