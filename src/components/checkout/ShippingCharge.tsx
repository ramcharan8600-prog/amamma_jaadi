import type { ShippingQuote } from '@/lib/pricing';
import { formatCurrency } from '@/lib/utils';

export default function ShippingCharge({ label, shipping, quote }: {
  label: string;
  shipping: number;
  quote?: ShippingQuote;
}) {
  const discounted = quote && quote.couponSavings > 0;
  return <div className="font-body text-sm text-brand-charcoal/70">
    <div className="flex justify-between gap-3">
      <span>{label}
        {discounted && quote.quantitySavings > 0 && <span className="block text-xs">Base rate before jar-count savings</span>}
      </span>
      <span className="shrink-0">
        {discounted && <s className="mr-2 text-brand-charcoal/50" aria-label="Shipping before savings">{formatCurrency(quote.referenceShipping)}</s>}
        <span className={discounted ? 'font-semibold text-green-800' : ''}>{shipping > 0 ? formatCurrency(shipping) : 'Free'}</span>
      </span>
    </div>
    {discounted && <p className="mt-1 text-xs text-green-800">
      {quote.quantitySavings > 0 && <>Jar-count savings: {formatCurrency(quote.quantitySavings)} · </>}
      Coupon savings: {formatCurrency(quote.couponSavings)}
    </p>}
  </div>;
}
