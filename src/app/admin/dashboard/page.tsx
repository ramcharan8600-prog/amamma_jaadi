'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, ChefHat, ChevronRight, RefreshCw, Store, Truck } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { toBusinessDateString } from '@/lib/date';
import { currentShipWeek, shipWeekDays, type DeliveryWeeksStatus } from '@/lib/delivery-limit';
import { productionSheet } from '@/lib/production';
import { PRODUCTS, isBobbatluProduct, isPieceStockSweet, isStockTracked } from '@/data/products';
import type { ProductionPlan } from '@/lib/production-plan';
import type { OrderRecord } from '@/types';
import type { ShippingZone } from '@/lib/pricing';

const ZONE_NAMES: Record<ShippingZone, string> = { texas: 'Texas', nearby: 'nearby states', far: 'far-away states' };

interface TodayData {
  plan: ProductionPlan | null;
  weeks: DeliveryWeeksStatus | null;
  paused: ShippingZone[];
  stock: Record<string, number> | null;
  latest: OrderRecord[];
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path, { cache: 'no-store' });
    return res.ok ? await res.json() as T : null;
  } catch {
    return null;
  }
}

function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' });
}

function StatCard({ href, label, value, detail }: { href: string; label: string; value: number | string; detail: string }) {
  return (
    <Link href={href} className="card p-4 block hover:shadow-md transition-shadow">
      <p className="font-body text-xs font-semibold uppercase tracking-wide text-brand-charcoal/60">{label}</p>
      <p className="font-display text-3xl font-bold text-brand-maroon mt-1">{value}</p>
      <p className="font-body text-xs text-brand-charcoal/60 mt-0.5">{detail}</p>
    </Link>
  );
}

/**
 * Admin → Today (home): what needs doing now. Needs-attention alerts, pickups today and
 * tomorrow, this week's shipment, delivery bookings, sweets to make and the newest orders.
 * Everything links to the page where it is handled.
 */
export default function AdminTodayPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [data, setData] = useState<TodayData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/auth')
      .then((res) => (res.ok ? setAuthed(true) : router.push('/admin/login')))
      .catch(() => router.push('/admin/login'));
  }, [router]);

  const load = useCallback(async () => {
    setLoading(true);
    const [plan, weeks, pauses, inventory, orders] = await Promise.all([
      getJson<ProductionPlan>('/api/admin/production-plan'),
      getJson<DeliveryWeeksStatus>('/api/admin/delivery-limit'),
      getJson<{ paused: ShippingZone[] }>('/api/delivery-pauses'),
      getJson<{ stock: Record<string, number> }>('/api/inventory'),
      getJson<{ orders: OrderRecord[] }>('/api/orders?filter=all&page=1&pageSize=5'),
    ]);
    setData({
      plan,
      weeks,
      paused: Array.isArray(pauses?.paused) ? pauses.paused : [],
      stock: inventory?.stock ?? null,
      latest: orders?.orders ?? [],
    });
    setLoading(false);
  }, []);

  useEffect(() => { if (authed) load(); }, [authed, load]);

  if (!authed) {
    return (
      <div className="section-padding py-16 text-center">
        <p className="font-body text-brand-charcoal/60">Checking authentication...</p>
      </div>
    );
  }

  const plan = data?.plan;
  const thisWeek = currentShipWeek();
  const delivery = plan?.delivery ?? [];
  const shipThisWeek = delivery.filter((o) => o.ship_week === thisWeek);
  const overdue = delivery.filter((o) => o.ship_week && o.ship_week < thisWeek);
  const noWeek = delivery.filter((o) => !o.ship_week);
  const nextWeek = data?.weeks?.weeks.find((w) => w.week > thisWeek);
  const outOfStock = data?.stock
    ? PRODUCTS.filter((p) => isStockTracked(p) && !isBobbatluProduct(p.id)
      // Malpuri / Malai Khaja with no count saved yet are untracked, not sold out.
      && !(isPieceStockSweet(p.id) && !(p.id in data.stock!)) && (data.stock![p.id] ?? 0) <= 0).map((p) => p.name)
    : [];
  const sheet = productionSheet(plan ? [...plan.days.flatMap((d) => d.orders), ...delivery].flatMap((o) => o.items) : []);

  const alerts: Array<{ text: string; href: string }> = [];
  if (overdue.length) alerts.push({ text: `${overdue.length} delivery ${overdue.length === 1 ? 'order is past its' : 'orders are past their'} ship week and not shipped`, href: '/admin/orders?shipmentStatus=yet_to_ship' });
  if (noWeek.length) alerts.push({ text: `${noWeek.length} delivery ${noWeek.length === 1 ? 'order has' : 'orders have'} no ship week`, href: '/admin/orders?shipWeek=none' });
  if (data?.paused.length) alerts.push({ text: `Delivery is paused for ${data.paused.map((z) => ZONE_NAMES[z]).join(', ')}`, href: '/admin/settings' });
  if (data?.weeks?.allFull) alerts.push({ text: 'Every delivery week is full, so customers cannot choose Delivery', href: '/admin/settings' });
  if (outOfStock.length) alerts.push({ text: `Out of stock on the website: ${outOfStock.join(', ')}`, href: '/admin/production#stock' });
  if (data && !plan) alerts.push({ text: 'Could not load today’s orders. Tap Refresh.', href: '/admin/dashboard' });

  return (
    <div className="section-padding py-6 sm:py-10 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-brand-charcoal">Today</h1>
          <p className="font-body text-sm text-brand-charcoal/60">{dayLabel(toBusinessDateString(new Date()))}</p>
        </div>
        <button type="button" onClick={load} disabled={loading} className="btn-secondary text-xs gap-1.5">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {!data ? (
        <p className="font-body text-sm text-brand-charcoal/50">Loading…</p>
      ) : (
        <>
          {alerts.length > 0 && (
            <section aria-labelledby="attention-title" className="rounded-xl border border-amber-300 bg-amber-50 p-4">
              <h2 id="attention-title" className="flex items-center gap-2 font-display text-base font-semibold text-amber-900">
                <AlertTriangle size={18} aria-hidden="true" /> Needs attention
              </h2>
              <ul className="mt-2 divide-y divide-amber-200">
                {alerts.map((a) => (
                  <li key={a.text}>
                    <Link href={a.href} className="flex items-center justify-between gap-3 py-2 font-body text-sm text-amber-950">
                      <span>{a.text}</span>
                      <ChevronRight size={16} className="shrink-0" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-label="At a glance" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard href="/admin/orders?filter=today" label="Pickups today" value={plan?.days[0]?.orders.length ?? '—'} detail="orders to hand over" />
            <StatCard href="/admin/orders?filter=tomorrow" label="Pickups tomorrow" value={plan?.days[1]?.orders.length ?? '—'} detail="orders to prepare" />
            <StatCard href={`/admin/orders?shipWeek=${thisWeek}`} label="This week’s shipment" value={plan ? shipThisWeek.length : '—'} detail={`to ship ${shipWeekDays(thisWeek)}`} />
            <StatCard
              href="/admin/settings"
              label="Next week booked"
              value={nextWeek ? (data.weeks?.limit != null ? `${nextWeek.used}/${data.weeks.limit}` : nextWeek.used) : '—'}
              detail={nextWeek ? `delivery orders · ships ${shipWeekDays(nextWeek.week)}` : 'delivery orders'}
            />
          </section>

          <section aria-labelledby="make-title" className="card p-5">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 id="make-title" className="flex items-center gap-2 font-display text-lg font-semibold text-brand-charcoal">
                <ChefHat size={20} className="text-brand-gold" aria-hidden="true" /> Sweets to make
              </h2>
              <Link href="/admin/production" className="font-body text-sm font-semibold text-brand-maroon inline-flex items-center gap-0.5">
                Kitchen <ChevronRight size={16} aria-hidden="true" />
              </Link>
            </div>
            <p className="font-body text-xs text-brand-charcoal/60 mb-3">Pickups for the next 3 days and every delivery not shipped yet. Pieces, boxes included.</p>
            {sheet.sweets.length === 0 ? (
              <p className="font-body text-sm text-brand-charcoal/50">Nothing to make yet.</p>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {sheet.sweets.map(({ sweet, pieces }) => (
                  <div key={sweet} className="bg-brand-gold/10 rounded-lg p-2 text-center">
                    <p className="font-display text-xl font-bold text-brand-maroon">{pieces}</p>
                    <p className="font-body text-xs font-medium text-brand-charcoal">{sweet}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section aria-labelledby="latest-title" className="card p-5">
            <div className="flex items-center justify-between gap-3 mb-2">
              <h2 id="latest-title" className="font-display text-lg font-semibold text-brand-charcoal">Newest orders</h2>
              <Link href="/admin/orders?filter=all" className="font-body text-sm font-semibold text-brand-maroon inline-flex items-center gap-0.5">
                All orders <ChevronRight size={16} aria-hidden="true" />
              </Link>
            </div>
            {data.latest.length === 0 ? (
              <p className="font-body text-sm text-brand-charcoal/50">No orders yet.</p>
            ) : (
              <ul className="divide-y divide-brand-cream-dark">
                {data.latest.map((o) => (
                  <li key={o.id}>
                    <Link href={`/admin/orders?q=${encodeURIComponent(o.order_number)}`} className="flex items-center gap-3 py-2.5 font-body text-sm">
                      {o.order_type === 'pickup'
                        ? <Store size={16} className="text-blue-700 shrink-0" aria-label="Pickup" />
                        : <Truck size={16} className="text-green-700 shrink-0" aria-label="Delivery" />}
                      <span className="min-w-0 flex-1">
                        <span className="font-semibold text-brand-maroon">{o.order_number}</span>
                        <span className="text-brand-charcoal"> · {o.customer_name}</span>
                        <span className="block text-xs text-brand-charcoal/60 truncate">
                          {o.order_type === 'pickup' ? `Pickup ${o.pickup_date ?? ''}` : o.ship_week ? `Delivery · ships ${shipWeekDays(o.ship_week)}` : 'Delivery'}
                        </span>
                      </span>
                      <span className="font-semibold text-brand-charcoal whitespace-nowrap">{formatCurrency(o.total_price)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
