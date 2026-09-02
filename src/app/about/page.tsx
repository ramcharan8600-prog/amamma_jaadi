import type { Metadata } from 'next';
import Image from 'next/image';
import { MapPin } from 'lucide-react';
import { WHATSAPP_NUMBER, PHONE_NUMBER } from '@/lib/utils';
import { DFW_CITIES, WIDER_TEXAS_CITIES } from '@/data/service-areas';
import { FAQS } from '@/data/faq';
import JsonLd from '@/components/JsonLd';
import { getFaqSchema } from '@/lib/seo';

export const metadata: Metadata = {
  title: 'Our Story, Areas We Serve & FAQs',
  description:
    'The story behind Amamma Jaadi — authentic Andhra sweets in Dallas, TX. Serving Plano, Frisco, Irving, Denton, McKinney, Allen, Richardson, Carrollton & across DFW, with shipping statewide.',
  alternates: { canonical: 'https://amammajaadi.com/about' },
  openGraph: {
    url: 'https://amammajaadi.com/about',
    title: 'Our Story, Areas We Serve & FAQs',
    description: 'Meet Amamma Jaadi and explore our service areas across Dallas-Fort Worth and Texas.',
  },
};

export default function AboutPage() {
  return (
    <>
      {/* Every Q&A below is rendered on the page — required for FAQ rich results. */}
      <JsonLd data={getFaqSchema()} />
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

      {/* Where we serve */}
      <section id="areas-we-serve" className="py-12 sm:py-16 bg-brand-cream/40 scroll-mt-24">
        <div className="section-padding max-w-3xl mx-auto space-y-5">
          <div className="flex items-center gap-2">
            <MapPin size={22} className="text-brand-gold" />
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-brand-charcoal">
              Areas We Serve
            </h2>
          </div>
          <p className="font-body text-brand-charcoal/70 leading-relaxed">
            We have happy customers right across the Dallas–Fort Worth
            metroplex, with free pickup at our partner locations and delivery to
            your doorstep:
          </p>
          <div className="flex flex-wrap gap-2">
            {DFW_CITIES.map((city) => (
              <span
                key={city}
                className="font-body text-sm bg-white border border-brand-cream-dark rounded-full px-3 py-1 text-brand-charcoal/80"
              >
                {city}
              </span>
            ))}
          </div>
          <p className="font-body text-brand-charcoal/70 leading-relaxed">
            We also ship further afield across Texas — including{' '}
            {WIDER_TEXAS_CITIES.join(', ')} — through our courier partners.
            Delivery charges apply per destination.
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-12 sm:py-16 scroll-mt-24">
        <div className="section-padding max-w-3xl mx-auto space-y-5">
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-brand-charcoal">
            Frequently Asked Questions
          </h2>
          <div className="space-y-3">
            {FAQS.map((faq) => (
              <details
                key={faq.question}
                className="group bg-white border border-brand-cream-dark rounded-xl p-4"
              >
                <summary className="font-body font-semibold text-brand-charcoal cursor-pointer list-none flex justify-between items-center gap-3">
                  {faq.question}
                  <span className="text-brand-gold shrink-0 transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="font-body text-sm text-brand-charcoal/70 leading-relaxed mt-3">
                  {faq.answer}
                </p>
              </details>
            ))}
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
                href={`https://wa.me/${WHATSAPP_NUMBER}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-maroon underline"
              >
                {PHONE_NUMBER}
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
