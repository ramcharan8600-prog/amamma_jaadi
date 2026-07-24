import type { Metadata } from 'next';
import { getProductsByCategory } from '@/data/products';
import GiftBoxCard from '@/components/product/GiftBoxCard';
import { Gift, Star, Calendar, Building2, Truck } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Events, Party Packs & Gift Boxes — South Indian Sweet Gifting',
  description:
    'Aluminium tin gift boxes filled with authentic South Indian sweets — Malai Khaja and Guntur Malpuri mixes from $30. Perfect for festivals, events, parties & corporate gifting.',
};

const OCCASIONS = [
  { icon: Star, label: 'Festivals', desc: 'Diwali, Sankranti, Ugadi & more' },
  { icon: Gift, label: 'Birthdays', desc: 'A sweet way to celebrate' },
  { icon: Calendar, label: 'Celebrations', desc: 'Weddings, housewarmings, milestones' },
  { icon: Building2, label: 'Corporate', desc: 'Impress clients & colleagues' },
];

export default function GiftBoxesPage() {
  const giftBoxes = getProductsByCategory('gift-boxes');

  return (
    <>
      {/* Hero */}
      <section className="bg-gradient-to-br from-brand-charcoal via-brand-maroon-dark to-brand-charcoal py-16 sm:py-24">
        <div className="section-padding text-center space-y-4">
          <p className="font-body text-sm font-semibold tracking-widest text-brand-gold uppercase">
            Events / Party Packs &amp; Gift Boxes
          </p>
          <h1 className="font-display text-4xl sm:text-5xl font-bold text-white">
            Celebrate Your Sweet Memories
          </h1>
          <p className="font-body text-lg text-white/70 max-w-lg mx-auto">
            Elegantly packaged in aluminium tins, our gift boxes make every
            occasion sweeter. A taste of tradition, wrapped with love.
          </p>
        </div>
      </section>

      {/* Occasions */}
      <section className="section-padding py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {OCCASIONS.map(({ icon: Icon, label, desc }) => (
            <div
              key={label}
              className="text-center p-5 rounded-xl bg-white border border-brand-cream-dark"
            >
              <Icon size={28} className="text-brand-gold mx-auto mb-2" />
              <h3 className="font-display text-base font-semibold text-brand-charcoal">
                {label}
              </h3>
              <p className="font-body text-xs text-brand-charcoal/60 mt-1">
                {desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Delivery banner */}
      <section className="section-padding pb-8">
        <div className="flex items-start gap-3 bg-brand-gold/10 border border-brand-gold/40 rounded-xl p-4 max-w-3xl mx-auto">
          <Truck size={22} className="text-brand-gold shrink-0 mt-0.5" />
          <p className="font-body text-sm text-brand-charcoal/80">
            <span className="font-semibold text-brand-charcoal">Delivery available:</span>{' '}
            we have tied up with trusted courier services to provide the best service.
            Pickup is free at our partner locations; delivery charges apply per
            destination and are confirmed with you at checkout.
          </p>
        </div>
      </section>

      {/* Products */}
      <section className="section-padding pb-16 sm:pb-24">
        <div className="grid md:grid-cols-2 gap-6 max-w-5xl mx-auto">
          {giftBoxes.map((product) => (
            <GiftBoxCard key={product.id} product={product} />
          ))}
        </div>
      </section>
    </>
  );
}
