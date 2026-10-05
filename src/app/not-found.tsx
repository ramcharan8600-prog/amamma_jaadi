import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Page not found',
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
          <Link href="/sweets" className="btn-primary">Sweets</Link>
          <Link href="/pickles" className="btn-secondary">Pickles</Link>
          <Link href="/gift-boxes" className="btn-secondary">Sweets Gift Packs</Link>
        </div>
        <p className="font-body text-sm">
          <Link href="/" className="text-brand-maroon underline underline-offset-4">Back to home</Link>
        </p>
      </div>
    </section>
  );
}
