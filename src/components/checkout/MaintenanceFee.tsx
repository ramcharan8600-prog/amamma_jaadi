import { formatCurrency } from '@/lib/utils';

export default function MaintenanceFee({ amount = 0 }: { amount?: number }) {
  if (!(amount > 0)) return null;
  return <div className="flex justify-between font-body text-sm text-brand-charcoal/70">
    <span>Maintenance fee</span><span>{formatCurrency(amount)}</span>
  </div>;
}
