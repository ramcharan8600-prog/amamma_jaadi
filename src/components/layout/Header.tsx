'use client';

import { Fragment, useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { ShoppingBag } from 'lucide-react';
import { useCartStore } from '@/store/cart';

const NAV_LINKS = [
  { label: 'Sweets', href: '/sweets' },
  { label: 'Gift Packs', href: '/gift-boxes' },
  { label: 'Pickles', href: '/pickles' },
  { label: 'Events', href: '/events' },
];
// About Us lives in the footer: the header is for shopping.

export default function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  const itemCount = useCartStore((s) => s.items.reduce((sum, i) => sum + i.quantity, 0));

  useEffect(() => {
    setMounted(true);
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const isCurrent = (href: string) => pathname === href;

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-brand-maroon/95 backdrop-blur-md shadow-sm'
          : 'bg-brand-maroon'
      }`}
    >
      <div className="section-padding">
        <div className="flex items-center justify-between gap-2 h-16 sm:h-20 lg:h-24">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <Image
              src="/images/web/logo-192.webp"
              alt="Amamma Jaadi"
              width={86}
              height={86}
              className="w-14 h-14 sm:w-[72px] sm:h-[72px] lg:w-[86px] lg:h-[86px] object-contain"
              priority
            />
            <span className="font-display font-bold text-brand-gold-light text-lg sm:text-xl tracking-widest uppercase whitespace-nowrap">
              Amamma Jaadi
            </span>
          </Link>

          {/* Wide screens: one row next to the logo. */}
          <nav aria-label="Main" className="hidden lg:flex items-center gap-8">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isCurrent(link.href) ? 'page' : undefined}
                className={`font-body text-sm font-medium transition-colors relative group ${
                  isCurrent(link.href) ? 'text-brand-gold-light' : 'text-white/80 hover:text-brand-gold-light'
                }`}
              >
                {link.label}
                <span className={`absolute -bottom-1 left-0 h-0.5 bg-brand-gold transition-all ${
                  isCurrent(link.href) ? 'w-full' : 'w-0 group-hover:w-full'
                }`} />
              </Link>
            ))}
          </nav>

          <Link
            href="/checkout"
            className="relative flex items-center gap-1.5 px-3 py-2 rounded-lg hover:bg-white/10 transition-colors"
          >
            <ShoppingBag size={20} className="text-white" />
            {/* Visible from sm; on phones it stays readable to screen readers. */}
            <span className="font-body text-sm font-medium text-white/80 sr-only sm:not-sr-only">
              Cart
            </span>
            {mounted && itemCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-brand-gold text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">
                {itemCount}
              </span>
            )}
          </Link>
        </div>

        {/* Phones and tablets: every link always visible under the logo. */}
        <nav
          aria-label="Main"
          className="lg:hidden flex flex-wrap justify-center gap-x-2.5 min-[360px]:gap-x-4 gap-y-1 border-t border-white/15 py-1.5"
        >
          {NAV_LINKS.map((link) => (
            <Fragment key={link.href}>
            <Link
              href={link.href}
              aria-current={isCurrent(link.href) ? 'page' : undefined}
              className={`font-body text-[16.4px] font-medium py-1 border-b-2 transition-colors ${
                isCurrent(link.href)
                  ? 'text-brand-gold-light border-brand-gold'
                  : 'text-white/85 border-transparent hover:text-white'
              }`}
            >
              {link.label}
            </Link>
            </Fragment>
          ))}
        </nav>
      </div>
    </header>
  );
}
