import Link from 'next/link';
import Image from 'next/image';
import { Instagram, Phone, MessageCircle } from 'lucide-react';
import { WHATSAPP_NUMBER, PHONE_NUMBER, INSTAGRAM_HANDLE } from '@/lib/utils';

export default function Footer() {
  return (
    <footer className="bg-brand-maroon text-white mt-auto">
      <div className="section-padding py-12 sm:py-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10 items-start">
          {/* Brand */}
          <div className="flex flex-col items-center md:items-start gap-4">
            <Image
              src="/images/brand/logo.png"
              alt="Amamma Jaadi"
              width={130}
              height={130}
              className="w-[105px] h-[105px] object-contain"
            />
            <p className="font-display text-lg text-brand-gold-light">
              Flavors of Home
            </p>
          </div>

          {/* Testimonial blurb */}
          <div className="text-center">
            <p className="font-body text-sm leading-relaxed text-white/80 max-w-xs mx-auto">
              Thousands of customers shared their love towards our products.
            </p>
          </div>

          {/* Social & Contact */}
          <div className="flex flex-col items-center md:items-end gap-4">
            <div className="flex items-center gap-5">
              <a
                href={`https://www.instagram.com/${INSTAGRAM_HANDLE}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Instagram"
                className="text-white/80 hover:text-brand-gold transition-colors"
              >
                <Instagram size={22} />
              </a>
              <a
                href={`https://wa.me/${WHATSAPP_NUMBER}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="WhatsApp"
                className="text-white/80 hover:text-brand-gold transition-colors"
              >
                <MessageCircle size={22} />
              </a>
              <a
                href={`tel:${PHONE_NUMBER.replace(/-/g, '')}`}
                aria-label="Phone"
                className="text-white/80 hover:text-brand-gold transition-colors"
              >
                <Phone size={22} />
              </a>
            </div>
            <p className="font-body text-xs text-white/60">{PHONE_NUMBER}</p>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-10 pt-6 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="font-body text-xs text-white/50">
            © {new Date().getFullYear()} Amamma Jaadi · Dallas, USA · Flavors of Home
          </p>
          <div className="flex gap-4">
            <Link
              href="/about#refund-policy"
              className="font-body text-xs text-white/50 hover:text-white transition-colors"
            >
              Refund Policy
            </Link>
            <Link
              href="/events"
              className="font-body text-xs text-white/50 hover:text-white transition-colors"
            >
              Events
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
