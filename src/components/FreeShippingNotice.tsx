import { Truck } from 'lucide-react';

/**
 * Informational banner: shipping fee varies by destination, order value and,
 * for far states, the selected transit speed.
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
        <strong>Shipping is calculated before payment</strong> from the destination, order value,
        and selected speed. Far-state orders can choose Ground or Expedited shipping. Pickup is
        always free.
      </p>
    </div>
  );
}
