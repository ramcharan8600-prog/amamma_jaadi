'use client';

import { usePathname } from 'next/navigation';
import WhatsAppIcon from '@/components/icons/WhatsAppIcon';
import { WHATSAPP_NUMBER } from '@/lib/utils';

/** Floating WhatsApp chat button. Hidden at checkout, where it covered the form and the Continue button on phones (the footer still links to WhatsApp). */
export default function WhatsAppButton() {
  const pathname = usePathname();
  if (pathname === '/checkout' || pathname?.startsWith('/checkout/')) return null;
  return (
    <a
      href={`https://wa.me/${WHATSAPP_NUMBER}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat on WhatsApp"
      className="fixed bottom-6 right-6 z-40 bg-green-500 hover:bg-green-600 text-white 
                 w-14 h-14 rounded-full flex items-center justify-center shadow-lg 
                 transition-all duration-200 hover:scale-105 group"
    >
      <WhatsAppIcon size={26} className="group-hover:scale-110 transition-transform" />
    </a>
  );
}
