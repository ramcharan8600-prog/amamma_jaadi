import { Truck } from 'lucide-react';
import { FREE_SHIPPING_THRESHOLD } from '@/lib/constants';

/**
 * Informational banner: free shipping over the threshold, small fee below.
 * Presentation only (no client state), so it works in both server and client
 * components. The actual delivery fee, if any, is arranged at fulfillment.
 */
export default function FreeShippingNotice({ className = '' }: { className?: string }) {
  return (
    <div
      className={`flex items-start gap-2.5 bg-brand-gold/10 border border-brand-gold/30 rounded-xl p-3.5 ${className}`}
    >
      <Truck size={18} className="text-brand-gold shrink-0 mt-0.5" />
      <p className="font-body text-sm text-brand-charcoal/80">
        <strong>Free shipping</strong> on orders over ${FREE_SHIPPING_THRESHOLD} — orders below $
        {FREE_SHIPPING_THRESHOLD} carry a small delivery charge.
      </p>
    </div>
  );
}
