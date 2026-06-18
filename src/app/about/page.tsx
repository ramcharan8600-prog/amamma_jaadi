import type { Metadata } from 'next';
import Image from 'next/image';

export const metadata: Metadata = {
  title: 'Our Story',
  description:
    'The story behind Amamma Jaadi — how a passion for traditional South Indian sweets brought authentic flavors of Andhra Pradesh to Dallas, Texas.',
};

export default function AboutPage() {
  return (
    <>
      {/* Hero */}
      <section className="bg-gradient-to-br from-brand-cream to-brand-cream-dark py-16 sm:py-24">
        <div className="section-padding text-center space-y-4">
          <p className="font-body text-sm font-semibold tracking-widest text-brand-gold uppercase">
            Our Story
          </p>
          <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold text-brand-charcoal">
            Dallas, USA
          </h1>
          <p className="font-display text-xl text-brand-maroon">
            Rooted in Andhra Pradesh
          </p>
        </div>
      </section>

      {/* Story Part 1 — Siri */}
      <section className="section-padding py-16 sm:py-24">
        <div className="max-w-3xl mx-auto space-y-8">
          <div className="grid md:grid-cols-2 gap-8 items-center">
            <div className="rounded-2xl overflow-hidden aspect-square bg-brand-cream">
              <Image
                src="/images/products/bobbatlu.jpg"
                alt="Traditional South Indian sweet making"
                width={500}
                height={500}
                className="object-cover w-full h-full"
              />
            </div>
            <div className="space-y-4">
              <p className="font-body text-brand-charcoal/80 leading-relaxed">
                It all started with a girl who grew up spending most of her time
                with Amamma, learning traditional recipes by heart. Baking these
                sweets is more than a skill — it&apos;s a passion, an interest,
                and an act of love. P.S. I&apos;m a foodie too 😋. Almost every
                heart melts for sweets.
              </p>
            </div>
          </div>

          <div className="space-y-6">
            <p className="font-body text-brand-charcoal/80 leading-relaxed">
              Like every NRI who moved to the USA, my story — Siri&apos;s story
              — started the same way. The passion for baking made me dream about
              turning it into something real.
            </p>
            <p className="font-body text-brand-charcoal/80 leading-relaxed">
              One day, I met another foodie —{' '}
              <span className="font-semibold text-brand-charcoal">SIMBA</span>{' '}
              — who shared the same vision and craziness. Someone who eats
              biryani every other day 😂 and finishes it off with sweets.
            </p>
            <p className="font-body text-brand-charcoal/80 leading-relaxed">
              After trying a wide range of sweets throughout the USA, we found
              that almost none matched the freshness, authenticity, and purity
              of organic ingredients we grew up with. We both had the same idea
              of starting a dessert place — and that gave rise to Amamma Jaadi.
            </p>
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="section-padding">
        <div className="h-px bg-gradient-to-r from-transparent via-brand-gold/40 to-transparent" />
      </div>

      {/* Story Part 2 — The Beginning */}
      <section className="section-padding py-16 sm:py-24">
        <div className="max-w-3xl mx-auto space-y-8">
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-brand-charcoal text-center">
            Amamma Jaadi — The Begining
          </h2>

          <div className="grid md:grid-cols-2 gap-8 items-center">
            <div className="space-y-4 md:order-2">
              <div className="rounded-2xl overflow-hidden aspect-square bg-brand-cream">
                <Image
                  src="/images/brand/logo.png"
                  alt="Amamma Jaadi brand"
                  width={500}
                  height={500}
                  className="object-contain w-full h-full p-8"
                />
              </div>
            </div>
            <div className="space-y-6">
              <p className="font-body text-brand-charcoal/80 leading-relaxed">
                Everyone grows up at their grandma&apos;s house, at least during
                the summers. The taste of food that Amamma brings to the table
                can&apos;t be matched — not even by Michelin-star restaurants.
              </p>

              <blockquote className="border-l-4 border-brand-gold pl-4 py-2">
                <p className="font-display text-lg text-brand-charcoal/90 italic">
                  &ldquo;The secret is patience and love — you can taste both in
                  every bite.&rdquo;
                </p>
                <p className="font-body text-sm text-brand-charcoal/50 mt-2">
                  — Amamma&apos;s kitchen wisdom
                </p>
              </blockquote>

              <p className="font-body text-brand-charcoal/80 leading-relaxed">
                Born from our love for Amamma, this brand kicked off as{' '}
                <span className="font-display font-semibold text-brand-maroon">
                  Amamma Jaadi
                </span>
                . Today, there are thousands of happy souls tasting delicious
                and authentic South Indian sweets.
              </p>
            </div>
          </div>

          <div className="bg-brand-maroon text-white rounded-2xl p-8 sm:p-12 text-center space-y-4">
            <p className="font-display text-2xl sm:text-3xl font-bold text-brand-gold-light">
              We are always delighted to see the smile on your face when you
              have our sweets. ❤️
            </p>
          </div>
        </div>
      </section>

      {/* Refund Policy */}
      <section id="refund-policy" className="py-12 sm:py-16 bg-white scroll-mt-24">
        <div className="section-padding max-w-3xl mx-auto space-y-6">
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-brand-charcoal">
            Refund &amp; Cancellation Policy
          </h2>

          <div className="font-body text-brand-charcoal/70 space-y-4 text-sm leading-relaxed">
            <p>
              At Amamma Jaadi, every order is freshly prepared by hand with love
              and care. Because our sweets and pickles are made-to-order using
              premium ingredients, we are unable to accept cancellations or
              issue refunds once an order has been placed.
            </p>
            <p>
              If there is a quality issue with your order, please contact us
              within 24 hours of pickup or delivery via WhatsApp at{' '}
              <a
                href="https://wa.me/5105745578"
                className="text-brand-maroon underline"
              >
                510-574-5578
              </a>{' '}
              and we will do our best to make it right.
            </p>
            <p className="font-semibold text-brand-charcoal">
              By placing an order, you agree to this policy. Thank you for
              understanding and supporting our small business.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
