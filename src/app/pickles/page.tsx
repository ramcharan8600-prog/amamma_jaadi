import type { Metadata } from 'next';
import { getProductsByCategory } from '@/data/products';
import PickleCard from '@/components/product/PickleCard';

export const metadata: Metadata = {
  title: 'Pickles — Authentic Andhra Non-Veg Pickles',
  description:
    'Order authentic Andhra chicken, mutton & prawns pickles in 12oz glass jars. Made with cold-pressed sesame oil and traditional spices. Available in Dallas, TX.',
};

export default function PicklesPage() {
  const pickles = getProductsByCategory('pickles');

  return (
    <div className="section-padding py-12 sm:py-16">
      <div className="text-center space-y-3 mb-12">
        <p className="font-body text-sm font-semibold tracking-widest text-brand-gold uppercase">
          Category
        </p>
        <h1 className="font-display text-4xl sm:text-5xl font-bold text-brand-charcoal">
          Pickles
        </h1>
        <p className="font-body text-brand-charcoal/60 max-w-lg mx-auto">
          Heirloom recipes in 12oz glass jars — crafted with cold-pressed sesame
          oil and the finest Andhra spices.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
        {pickles.map((product) => (
          <PickleCard key={product.id} product={product} />
        ))}
      </div>
    </div>
  );
}
