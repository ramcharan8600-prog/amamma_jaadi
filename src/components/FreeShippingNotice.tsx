import { Truck } from 'lucide-react';
import { FREE_SHIPPING_THRESHOLD } from '@/lib/constants';

/**
 * Informational banner: shipping fee varies by location and order value.
 * Presentation only (no client state), so it works in both server and client
 * components. The actual delivery fee is computed at checkout.
 */
export default function FreeShippingNotice({ className = '' }: { className?: string }) {
  return (
    <div
      className={`flex items-start gap-2.5 bg-brand-gold/10 border border-brand-gold/30 rounded-xl p-3.5 ${className}`}
    >
      <Truck size={18} className="text-brand-gold shrink-0 mt-0.5" />
      <p className="font-body text-sm text-brand-charcoal/80">
        <strong>Free shipping</strong> within Texas on orders of ${FREE_SHIPPING_THRESHOLD} and above.
        Out-of-state orders ship for $2.99 at ${FREE_SHIPPING_THRESHOLD}+. Below ${FREE_SHIPPING_THRESHOLD},
        a delivery fee applies and is shown before you pay. Pickup is always free.
      </p>
    </div>
  );
}
