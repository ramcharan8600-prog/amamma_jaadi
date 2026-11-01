import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Page not found',
  // Replaces the root layout's "index, follow" so the page doesn't send both.
  robots: { index: false, follow: true },
};

/** Shown for any URL the site doesn't have (old links, typos), with the header and footer. */
export default function NotFound() {
  return (
    <section className="bg-gradient-to-br from-brand-cream to-brand-cream-dark py-16 sm:py-24">
      <div className="section-padding text-center space-y-5">
        <p className="font-body text-sm font-semibold tracking-widest text-brand-maroon uppercase">
          Page not found
        </p>
        <h1 className="font-display text-3xl sm:text-4xl font-bold text-brand-charcoal">
          This page isn&apos;t on our menu
        </h1>
        <p className="font-body text-brand-charcoal/80 max-w-md mx-auto">
          The link may be old or mistyped. Our sweets and pickles are right here:
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <a href="/sweets" className="btn-primary">Sweets</a>
          <a href="/pickles" className="btn-secondary">Pickles</a>
          <a href="/gift-boxes" className="btn-secondary">Sweets Gift Packs</a>
        </div>
        <p className="font-body text-sm">
          <a href="/" className="text-brand-maroon underline underline-offset-4">Back to home</a>
        </p>
      </div>
    </section>
  );
}
