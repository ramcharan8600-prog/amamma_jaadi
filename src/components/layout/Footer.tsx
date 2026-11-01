import Image from 'next/image';
import { Instagram, MapPin, Phone } from 'lucide-react';
import WhatsAppIcon from '@/components/icons/WhatsAppIcon';
import { WHATSAPP_NUMBER, PHONE_NUMBER, INSTAGRAM_HANDLE } from '@/lib/utils';
import { ACTIVE_PICKUP_LOCATIONS } from '@/data/products';

/** Pickup cities in location order (Plano, Frisco, Irving), each listed once. */
const PICKUP_CITIES = Array.from(new Set(ACTIVE_PICKUP_LOCATIONS.map((location) => location.city)));

export default function Footer() {
  return (
    <footer className="bg-brand-maroon text-white mt-auto">
      <div className="section-padding py-12 sm:py-16">
        {/* Phones: logo left, pickup cities right, then the blurb and contacts below.
            Wider screens: logo | blurb + contacts | pickup cities. */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-10 items-center">
          {/* Brand */}
          <div className="col-start-1 row-start-1 flex flex-col items-center justify-self-start gap-3 ml-6 min-[360px]:ml-12 min-[375px]:ml-16 md:ml-32">
            <Image
              src="/images/web/logo-192.webp"
              alt="Amamma Jaadi"
              width={131}
              height={131}
              className="w-[131px] h-[131px] object-contain"
            />
            <p className="font-display text-lg text-brand-gold-light whitespace-nowrap">
              Flavors of Home
            </p>
          </div>

          {/* Pickup cities */}
          <ul
            aria-label="Pickup locations"
            className="col-start-2 row-start-1 md:col-start-3 justify-self-end space-y-3 mr-4 min-[360px]:mr-7 min-[375px]:mr-11 md:mr-16"
          >
            {PICKUP_CITIES.map((city) => (
              <li key={city} className="flex items-center gap-2 font-body text-base text-white/90">
                <MapPin size={20} className="text-brand-gold-light shrink-0" aria-hidden="true" />
                {city}
              </li>
            ))}
          </ul>

          {/* Testimonial blurb and contacts */}
          <div className="col-span-2 md:col-span-1 md:col-start-2 md:row-start-1 flex flex-col items-center gap-6 text-center">
            <p className="font-body text-sm leading-relaxed text-white/80 max-w-xs mx-auto">
              Thousands of customers shared their love towards our products.
            </p>
            {/* Icons and links get a larger tap area (p-2 / py-2) without moving: the
                negative margins cancel the padding in the layout. */}
            <div className="flex items-center gap-5">
              <a
                href={`https://www.instagram.com/${INSTAGRAM_HANDLE}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Instagram"
                className="-m-2 p-2 text-white/80 hover:text-brand-gold transition-colors"
              >
                <Instagram size={22} />
              </a>
              <a
                href={`https://wa.me/${WHATSAPP_NUMBER}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="WhatsApp"
                className="-m-2 p-2 text-white/80 hover:text-brand-gold transition-colors"
              >
                <WhatsAppIcon size={22} />
              </a>
              <a
                href={`tel:${PHONE_NUMBER.replace(/-/g, '')}`}
                aria-label="Phone"
                className="-m-2 p-2 text-white/80 hover:text-brand-gold transition-colors"
              >
                <Phone size={22} />
              </a>
            </div>
            <p className="font-body text-xs text-white/60 -mt-2">{PHONE_NUMBER}</p>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-10 pt-6 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="font-body text-xs text-white/50">
            © {new Date().getFullYear()} Amamma Jaadi · Dallas, USA · Flavors of Home
          </p>
          {/* sm:pr-20 keeps the links clear of the floating WhatsApp button. */}
          <div className="flex gap-4 sm:pr-20">
            <a
              href="/about"
              className="-my-2 inline-block py-2 font-body text-xs text-white/50 hover:text-white transition-colors"
            >
              About Us
            </a>
            <a
              href="/about#refund-policy"
              className="-my-2 inline-block py-2 font-body text-xs text-white/50 hover:text-white transition-colors"
            >
              Refund Policy
            </a>
            <a
              href="/events"
              className="-my-2 inline-block py-2 font-body text-xs text-white/50 hover:text-white transition-colors"
            >
              Events
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
