'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ChefHat, ChevronDown, RefreshCw, Truck } from 'lucide-react';
import { getPickupLocationById } from '@/data/products';
import { isPickupClosedDate } from '@/lib/pickup-date';
import { productionSheet } from '@/lib/production';
import type { PlanOrder, ProductionPlan } from '@/lib/production-plan';

const DAY_NAMES = ['Today', 'Tomorrow', 'Day after tomorrow'];

function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
}

function itemLabel(item: PlanOrder['items'][number]): string {
  return `${item.product_name}${item.selected_tier ? ` (${item.selected_tier} pcs)` : ''} × ${item.quantity}`;
}

/** Sweets to make, what to pack, and (on tap) each order with its items. */
function PlanCard({ title, subtitle, orders, note, icon }: {
  title: string;
  subtitle?: string;
  orders: PlanOrder[];
  note?: string;
  icon: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const sheet = productionSheet(orders.flatMap((order) => order.items));
  const id = title.toLowerCase().replace(/[^a-z]+/g, '-');

  return (
    <section aria-labelledby={`${id}-title`} className="card p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          {icon}
          <div>
            <h2 id={`${id}-title`} className="font-display text-lg font-semibold text-brand-charcoal">{title}</h2>
            {subtitle && <p className="font-body text-xs text-brand-charcoal/60">{subtitle}</p>}
          </div>
        </div>
        <span className="font-body text-sm font-semibold text-brand-maroon whitespace-nowrap">
          {orders.length} {orders.length === 1 ? 'order' : 'orders'}
        </span>
      </div>

      {note && <p className="font-body text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">{note}</p>}

      {orders.length === 0 ? (
        <p className="font-body text-sm text-brand-charcoal/50">No orders yet.</p>
      ) : (
        <>
          {sheet.sweets.length > 0 && (
            <div>
              <h3 className="font-body text-xs font-semibold uppercase tracking-wide text-brand-charcoal/60 mb-2">Sweets to make</h3>
              <div className="grid grid-cols-3 gap-2">
                {sheet.sweets.map(({ sweet, pieces }) => (
                  <div key={sweet} className="bg-brand-gold/10 rounded-lg p-2 text-center">
                    <p className="font-display text-xl font-bold text-brand-maroon">{pieces}</p>
                    <p className="font-body text-[11px] text-brand-charcoal/60">pcs</p>
                    <p className="font-body text-xs font-medium text-brand-charcoal">{sweet}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <h3 className="font-body text-xs font-semibold uppercase tracking-wide text-brand-charcoal/60 mb-2">To pack</h3>
            <ul className="divide-y divide-brand-cream-dark border border-brand-cream-dark rounded-lg">
              {sheet.items.map(({ label, count, unit }) => (
                <li key={label} className="flex items-start justify-between gap-3 px-3 py-1.5 font-body text-sm">
                  <span className="text-brand-charcoal">{label}</span>
                  <span className="font-semibold text-brand-maroon whitespace-nowrap">{count} {unit}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-controls={`${id}-orders`}
              className="inline-flex items-center gap-1 font-body text-sm font-semibold text-brand-maroon underline underline-offset-2"
            >
              {open ? 'Hide orders' : `Show orders (${orders.length})`}
              <ChevronDown size={14} aria-hidden="true" className={`transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
              <ul id={`${id}-orders`} className="mt-2 space-y-2">
                {orders.map((order) => (
                  <li key={order.id} className="border border-brand-cream-dark rounded-lg p-3">
                    <p className="font-body text-sm">
                      <span className="font-semibold text-brand-charcoal">{order.order_number}</span>
                      <span className="text-brand-charcoal/60"> · {order.customer_name}</span>
                      <span className="text-brand-charcoal/60">
                        {' · '}{order.order_type === 'pickup'
                          ? getPickupLocationById(order.pickup_location ?? '')?.name ?? order.pickup_location ?? 'Pickup'
                          : 'Delivery'}
                      </span>
                    </p>
                    <ul className="mt-1 font-body text-sm text-brand-charcoal/80 list-disc pl-5">
                      {order.items.map((item, i) => <li key={i}>{itemLabel(item)}</li>)}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/** Admin → Production Planning: sweets to make for today, tomorrow and the day after. */
export default function ProductionPlanningPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [plan, setPlan] = useState<ProductionPlan | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auth')
      .then((res) => (res.ok ? setAuthed(true) : router.push('/admin/login')))
      .catch(() => router.push('/admin/login'));
  }, [router]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/production-plan', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !Array.isArray(data.days) || !Array.isArray(data.delivery)) throw new Error();
      setPlan(data);
    } catch {
      setError('Could not load the production plan. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authed) load();
  }, [authed, load]);

  if (!authed) {
    return (
      <div className="section-padding py-16 text-center">
        <p className="font-body text-brand-charcoal/60">Checking authentication...</p>
      </div>
    );
  }

  const allOrders = plan ? [...plan.days.flatMap((day) => day.orders), ...plan.delivery] : [];
  const total = productionSheet(allOrders.flatMap((order) => order.items));

  return (
    <div className="section-padding py-8 sm:py-12">
      <Link href="/admin/dashboard" className="inline-flex items-center gap-2 text-sm text-brand-maroon mb-6">
        <ArrowLeft size={16} /> Dashboard
      </Link>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-brand-charcoal">Production Planning</h1>
          <p className="font-body text-sm text-brand-charcoal/50">
            Sweets to make from paid orders: pickups by date, and delivery orders waiting to ship.
          </p>
        </div>
        <button type="button" onClick={load} disabled={loading} className="btn-secondary text-xs gap-1.5">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && <p role="alert" className="font-body text-sm text-red-600 mb-4">{error}</p>}

      {plan && (
        <>
          <section aria-labelledby="plan-total" className="card p-5 mb-6">
            <h2 id="plan-total" className="font-display text-lg font-semibold text-brand-charcoal">Total for the next 3 days</h2>
            <p className="font-body text-xs text-brand-charcoal/60 mb-3">
              All pickups today, tomorrow and the day after, plus delivery orders waiting to ship. Pieces, including what goes inside boxes.
            </p>
            {total.sweets.length === 0 ? (
              <p className="font-body text-sm text-brand-charcoal/50">No sweets to make yet.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {total.sweets.map(({ sweet, pieces }) => (
                  <div key={sweet} className="bg-brand-cream rounded-lg p-3 text-center">
                    <p className="font-display text-2xl font-bold text-brand-maroon">{pieces}</p>
                    <p className="font-body text-xs text-brand-charcoal/60">pcs</p>
                    <p className="font-body text-sm font-medium text-brand-charcoal">{sweet}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="grid lg:grid-cols-3 gap-4 mb-4">
            {plan.days.map((day, i) => (
              <PlanCard
                key={day.date}
                title={DAY_NAMES[i] ?? dayLabel(day.date)}
                subtitle={`Pickup · ${dayLabel(day.date)}`}
                orders={day.orders}
                note={isPickupClosedDate(day.date) ? 'Pickup is closed on Tuesdays.' : undefined}
                icon={<ChefHat size={20} className="text-brand-gold shrink-0 mt-0.5" />}
              />
            ))}
          </div>

          <PlanCard
            title="Delivery orders waiting to ship"
            subtitle="Any order date, not shipped yet"
            orders={plan.delivery}
            icon={<Truck size={20} className="text-brand-gold shrink-0 mt-0.5" />}
          />
        </>
      )}
    </div>
  );
}
