import Link from 'next/link';
import { BarChart3, ChevronRight, Receipt, Ticket } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const REPORTS: Array<{ href: string; title: string; detail: string; icon: LucideIcon }> = [
  { href: '/admin/analytics', title: 'Sales analytics', detail: 'Revenue by week and month, best-selling products and busiest days (asks for your PIN).', icon: BarChart3 },
  { href: '/admin/taxes', title: 'Quarterly tax records', detail: 'Sales and refunds by quarter, with CSV downloads for filing.', icon: Receipt },
  { href: '/admin/coupons', title: 'Coupon performance', detail: 'Orders and sales brought in by each coupon.', icon: Ticket },
];

/** Admin → Reports: every report in one list. */
export default function AdminReportsPage() {
  return (
    <div className="section-padding py-6 sm:py-10">
      <h1 className="font-display text-2xl sm:text-3xl font-bold text-brand-charcoal">Reports</h1>
      <p className="font-body text-sm text-brand-charcoal/60 mb-6">Sales, taxes and coupons.</p>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map(({ href, title, detail, icon: Icon }) => (
          <li key={href}>
            <Link href={href} className="card p-5 h-full flex items-start gap-3 hover:shadow-md transition-shadow">
              <Icon size={22} className="text-brand-gold shrink-0 mt-0.5" aria-hidden="true" />
              <span className="flex-1">
                <span className="block font-display text-lg font-semibold text-brand-charcoal">{title}</span>
                <span className="block font-body text-xs text-brand-charcoal/60 mt-0.5">{detail}</span>
              </span>
              <ChevronRight size={18} className="text-brand-maroon mt-1" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
