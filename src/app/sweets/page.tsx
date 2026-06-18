import type { Metadata } from 'next';
import { getProductsByCategory } from '@/data/products';
import SweetCard from '@/components/product/SweetCard';

export const metadata: Metadata = {
  title: 'Sweets — Freshly Baked South Indian Sweets',
  description:
    'Order fresh Bobbatlu, Kaju Katli, Malai Khaja, Kova & Guntur Malpuri. Made daily with pure ghee, A2 milk & organic ingredients. Pickup or delivery in Dallas, TX.',
};

export default function SweetsPage() {
  const sweets = getProductsByCategory('sweets');

  return (
    <div className="section-padding py-12 sm:py-16">
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
        {sweets.map((product) => (
          <SweetCard key={product.id} product={product} />
        ))}
      </div>
    </div>
  );
}
