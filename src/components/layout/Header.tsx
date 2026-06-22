'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Menu, X, ShoppingBag } from 'lucide-react';
import { useCartStore } from '@/store/cart';

const NAV_LINKS = [
  { label: 'Pickles', href: '/pickles' },
  { label: 'Sweets', href: '/sweets' },
  { label: 'Gift Boxes', href: '/gift-boxes' },
  { label: 'Events', href: '/events' },
  { label: 'About Us', href: '/about' },
];

export default function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [mounted, setMounted] = useState(false);
  const itemCount = useCartStore((s) => s.items.reduce((sum, i) => sum + i.quantity, 0));

  useEffect(() => {
    setMounted(true);
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-brand-maroon/95 backdrop-blur-md shadow-sm'
          : 'bg-brand-maroon'
      }`}
    >
      <div className="section-padding">
        <div className="flex items-center justify-between h-20 sm:h-24">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <Image
              src="/images/brand/logo.png"
              alt="Amamma Jaadi"
              width={86}
              height={86}
              className="w-[72px] h-[72px] sm:w-[86px] sm:h-[86px] object-contain"
              priority
            />
            <span className="font-display font-bold text-brand-gold-light text-lg sm:text-xl tracking-widest uppercase whitespace-nowrap">
              Amamma Jaadi
            </span>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-8">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="font-body text-sm font-medium text-white/80 hover:text-brand-gold-light transition-colors relative group"
              >
                {link.label}
                <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-brand-gold transition-all group-hover:w-full" />
              </Link>
            ))}
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-3">
            <Link
              href="/checkout"
              className="relative flex items-center gap-1.5 px-3 py-2 rounded-lg hover:bg-white/10 transition-colors"
            >
              <ShoppingBag size={20} className="text-white" />
              <span className="font-body text-sm font-medium text-white/80 hidden sm:inline">
                Cart
              </span>
              {mounted && itemCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-brand-gold text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">
                  {itemCount}
                </span>
              )}
            </Link>

            {/* Mobile menu button */}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="md:hidden p-2 rounded-lg hover:bg-white/10 transition-colors"
              aria-label="Toggle menu"
            >
              {mobileOpen ? (
                <X size={22} className="text-white" />
              ) : (
                <Menu size={22} className="text-white" />
              )}
            </button>
          </div>
        </div>

        {/* Mobile nav */}
        {mobileOpen && (
          <nav className="md:hidden pb-4 border-t border-white/20 pt-3 space-y-1">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="block px-4 py-2.5 font-body text-sm font-medium text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </header>
  );
}
