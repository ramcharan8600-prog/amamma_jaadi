import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, Leaf, Heart, Sparkles, Truck } from 'lucide-react';
import { PRODUCTS } from '@/data/products';

const PROMISES = [
  { icon: Leaf, label: 'Pure Ghee & A2 Milk' },
  { icon: Heart, label: 'Made with Love' },
  { icon: Sparkles, label: 'Freshly Baked Daily' },
  { icon: Truck, label: 'Same-Day Pickup' },
];

export default function HomePage() {
  const featuredSweets = PRODUCTS.filter((p) => p.category === 'sweets').slice(0, 3);

  return (
    <>
      {/* ── Hero ──────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-cream via-brand-warm-white to-brand-cream-dark">
        <div className="section-padding py-16 sm:py-24 lg:py-32">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="space-y-8">
              <div className="space-y-4">
                <p className="font-body text-sm font-semibold tracking-widest text-brand-gold uppercase">
                  Dallas, Texas
                </p>
                <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold text-brand-charcoal leading-[1.1]">
                  The taste of{' '}
                  <span className="text-brand-maroon">Amamma&apos;s</span>{' '}
                  kitchen
                </h1>
                <p className="font-body text-lg text-brand-charcoal/70 max-w-lg leading-relaxed">
                  Traditional South Indian sweets made the same way your grandmother
                  made them — with patience, pure ghee, and a whole lot of love.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Link href="/sweets" className="btn-primary gap-2">
                  Order Sweets <ArrowRight size={16} />
                </Link>
                <Link href="/gift-boxes" className="btn-gold gap-2">
                  Gift Boxes
                </Link>
                <Link href="/pickles" className="btn-secondary">
                  Pickles
                </Link>
              </div>

              {/* Promises */}
              <div className="grid grid-cols-2 gap-3 pt-4">
                {PROMISES.map(({ icon: Icon, label }) => (
                  <div
                    key={label}
                    className="flex items-center gap-2.5 text-brand-charcoal/70"
                  >
                    <span className="w-8 h-8 rounded-full bg-brand-gold/10 flex items-center justify-center shrink-0">
                      <Icon size={15} className="text-brand-gold" />
                    </span>
                    <span className="font-body text-xs font-medium">{label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Hero image collage */}
            <div className="relative hidden md:block">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-4">
                  <div className="rounded-2xl overflow-hidden shadow-lg aspect-square">
                    <Image
                      src="/images/products/bobbatlu.jpg"
                      alt="Bobbatlu"
                      width={400}
                      height={400}
                      className="object-cover w-full h-full"
                      priority
                    />
                  </div>
                  <div className="rounded-2xl overflow-hidden shadow-lg aspect-[4/3]">
                    <Image
                      src="/images/products/Kaju Katli.jpeg"
                      alt="Kaju Katli"
                      width={400}
                      height={300}
                      className="object-cover w-full h-full"
                    />
                  </div>
                </div>
                <div className="pt-8 space-y-4">
                  <div className="rounded-2xl overflow-hidden shadow-lg aspect-[4/3]">
                    <Image
                      src="/images/products/Guntur Malpuri.jpg"
                      alt="Guntur Malpuri"
                      width={400}
                      height={300}
                      className="object-cover w-full h-full"
                    />
                  </div>
                  <div className="rounded-2xl overflow-hidden shadow-lg aspect-square">
                    <Image
                      src="/images/products/nellore malai khaja.jpg"
                      alt="Malai Khaja"
                      width={400}
                      height={400}
                      className="object-cover w-full h-full"
                    />
                  </div>
                </div>
              </div>
              {/* Decorative */}
              <div className="absolute -top-6 -right-6 w-24 h-24 bg-brand-gold/10 rounded-full blur-2xl" />
              <div className="absolute -bottom-6 -left-6 w-32 h-32 bg-brand-maroon/5 rounded-full blur-2xl" />
            </div>
          </div>
        </div>
      </section>

      {/* ── Featured Sweets ──────────────────────────────── */}
      <section className="py-16 sm:py-24">
        <div className="section-padding">
          <div className="text-center space-y-3 mb-12">
            <p className="font-body text-sm font-semibold tracking-widest text-brand-gold uppercase">
              Our Specialties
            </p>
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-brand-charcoal">
              Freshly Made Every Day
            </h2>
            <p className="font-body text-brand-charcoal/60 max-w-md mx-auto">
              Each sweet is crafted with organic ingredients, pure ghee, and recipes
              passed down through generations.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {featuredSweets.map((product) => (
              <Link
                key={product.id}
                href="/sweets"
                className="card group cursor-pointer"
              >
                <div className="relative aspect-[4/3] overflow-hidden">
                  <Image
                    src={product.image}
                    alt={product.name}
                    fill
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    className="object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                </div>
                <div className="p-5">
                  <h3 className="font-display text-xl font-semibold text-brand-charcoal">
                    {product.name}
                  </h3>
                  <p className="font-body text-sm text-brand-charcoal/60 mt-1 line-clamp-2">
                    {product.description}
                  </p>
                  <p className="font-body text-sm font-semibold text-brand-maroon mt-3">
                    Starting at ${product.unitPrice * 16}
                  </p>
                </div>
              </Link>
            ))}
          </div>

          <div className="text-center mt-10">
            <Link href="/sweets" className="btn-primary gap-2">
              View All Sweets <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Brand Story Teaser ───────────────────────────── */}
      <section className="py-16 sm:py-24 bg-brand-maroon text-white">
        <div className="section-padding">
          <div className="max-w-3xl mx-auto text-center space-y-6">
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-brand-gold-light">
              Born from Love for Amamma
            </h2>
            <p className="font-body text-lg text-white/80 leading-relaxed">
              It all started with a girl who grew up at her grandmother&apos;s side, learning
              recipes by heart. Today, Amamma Jaadi brings that same authenticity —
              the patience, the pure ingredients, the love you can taste in every
              bite — to NRIs across America.
            </p>
            <Link
              href="/about"
              className="inline-flex items-center gap-2 font-body text-sm font-semibold text-brand-gold hover:text-brand-gold-light transition-colors"
            >
              Read Our Story <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Categories Quick Links ───────────────────────── */}
      <section className="py-16 sm:py-24">
        <div className="section-padding">
          <div className="grid sm:grid-cols-3 gap-6">
            {[
              { title: 'Sweets', desc: 'Bobbatlu, Kaju Katli, Kova & more', href: '/sweets', img: '/images/products/bobbatlu.jpg' },
              { title: 'Pickles', desc: 'Chicken, Mutton & Prawns', href: '/pickles', img: '/images/products/Chicken Pickle.jpg' },
              { title: 'Gift Boxes', desc: 'Premium aluminium tin packaging', href: '/gift-boxes', img: '/images/products/gift box.png' },
            ].map((cat) => (
              <Link key={cat.href} href={cat.href} className="group relative rounded-2xl overflow-hidden aspect-[3/2]">
                <Image src={cat.img} alt={cat.title} fill className="object-cover group-hover:scale-105 transition-transform duration-500" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                <div className="absolute bottom-0 left-0 p-6">
                  <h3 className="font-display text-2xl font-bold text-white">{cat.title}</h3>
                  <p className="font-body text-sm text-white/80 mt-1">{cat.desc}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
