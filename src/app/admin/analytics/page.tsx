'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  DollarSign,
  ShoppingBag,
  Minus,
  Lock,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { PRODUCTS } from '@/data/products';
import { getSalesTimeSeries } from '@/lib/sales-analytics';
import type { OrderRecord } from '@/types';

/**
 * Resolve a product's category from the catalog by name (order_items store the
 * name only). Gift box lines are recorded as "Name (chosen contents)", so strip
 * any trailing parenthetical before matching or they'd fall into 'other'.
 */
function categoryForProduct(name: string): string {
  const base = String(name).replace(/\s*\(.*\)\s*$/, '').trim();
  return PRODUCTS.find((p) => p.name === base)?.category || 'other';
}

function netOrderRevenue(order: OrderRecord): number {
  const total = Number(order.total_price) || 0;
  const refunded = Number(order.refunded_amount) || 0;
  return Math.max(0, total - refunded);
}

function AnalyticsBarChart({ label, data, formatValue, barClassName, weekly = false, minimumWidth = 400, wrapLabels = false }: {
  label: string;
  data: { label: string; value: number; rangeLabel?: string }[];
  formatValue: (value: number) => string;
  barClassName: string;
  weekly?: boolean;
  minimumWidth?: number;
  wrapLabels?: boolean;
}) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const selected = data[selectedIndex ?? data.length - 1];
  const maximum = Math.max(...data.map(point => point.value), 1);
  const plotHeight = 128;
  return (
    <>
      {weekly && selected && <div className="flex flex-wrap justify-between gap-2 mb-3 font-body text-xs">
        <p role="status" aria-live="polite" className="text-brand-charcoal">
          {selected.rangeLabel ?? selected.label}: <strong>{formatValue(selected.value)}</strong>
        </p>
        <p className="text-brand-charcoal/60">Hover or select a week for details. Scroll to see more on smaller screens.</p>
      </div>}
      <div className="overflow-x-auto">
      <ul aria-label={label} className={`flex ${weekly ? 'gap-1' : 'gap-2'}`} style={{ minWidth: minimumWidth }}>
        {data.map((point, index) => (
          <li key={point.label} className="min-w-0 flex-1 text-center"
            title={`${point.rangeLabel ?? point.label}: ${formatValue(point.value)}`}>
            {!weekly && <span className="block font-body text-[10px] font-medium text-brand-charcoal mb-2 whitespace-nowrap">
              {formatValue(point.value)}
            </span>}
            {weekly ? <button type="button" className="relative block w-full border-b border-brand-cream-dark rounded-t focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-maroon hover:bg-brand-cream"
              style={{ height: plotHeight }} aria-label={`${point.rangeLabel ?? point.label}: ${formatValue(point.value)}`}
              onMouseEnter={() => setSelectedIndex(index)} onFocus={() => setSelectedIndex(index)} onClick={() => setSelectedIndex(index)}>
              <span aria-hidden="true" className={`absolute bottom-0 left-0 w-full rounded-t ${barClassName}`}
                style={{ height: point.value > 0 ? Math.max(4, point.value / maximum * plotHeight) : 0 }} />
            </button> : <div aria-hidden="true" className="relative w-full border-b border-brand-cream-dark" style={{ height: plotHeight }}>
              <div className={`absolute bottom-0 w-full rounded-t ${barClassName}`}
                style={{ height: point.value > 0 ? Math.max(4, point.value / maximum * plotHeight) : 0 }} />
            </div>}
            <span aria-hidden={weekly || undefined} className={`block font-body text-[10px] text-brand-charcoal/60 mt-2 ${wrapLabels ? 'whitespace-normal break-words' : 'whitespace-nowrap'} ${weekly && index % 4 !== 0 && index !== data.length - 1 ? 'invisible' : ''} ${weekly && index === data.length - 1 ? 'text-right' : ''} ${weekly && index === 0 ? 'text-left' : ''}`}>
              {point.label}
            </span>
          </li>
        ))}
      </ul>
      </div>
    </>
  );
}

export default function AnalyticsPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [authLoading, setAuthLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [authed, setAuthed] = useState(false);
  const [pinVerified, setPinVerified] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch('/api/auth');
        if (res.ok) {
          setAuthed(true);
        } else {
          router.push('/admin/login');
        }
      } catch {
        router.push('/admin/login');
      } finally {
        setAuthLoading(false);
      }
    };
    checkAuth();
  }, [router]);

  const verifyPin = async () => {
    try {
      const res = await fetch('/api/auth/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      if (res.ok) {
        setPinVerified(true);
      } else {
        setPinError('Incorrect PIN');
        setPin('');
      }
    } catch {
      setPinError('Verification failed');
    }
  };

  useEffect(() => {
    if (!authed || !pinVerified) return;
    const controller = new AbortController();
    const fetchAll = async () => {
      setDataLoading(true);
      setDataError('');
      try {
        const res = await fetch('/api/orders?filter=all', { cache: 'no-store', signal: controller.signal });
        if (!res.ok) throw new Error('Order request failed');
        const data = await res.json();
        if (!Array.isArray(data.orders)) throw new Error('Invalid order response');
        if (!controller.signal.aborted) setOrders(data.orders);
      } catch {
        if (!controller.signal.aborted) setDataError('Unable to load sales data. Please try again.');
      } finally {
        if (!controller.signal.aborted) setDataLoading(false);
      }
    };
    fetchAll();
    return () => controller.abort();
  }, [authed, pinVerified, loadAttempt]);

  const analytics = useMemo(() => {
    // Partial refunds remain real orders, but revenue should reflect only the
    // amount the business retained. Fully refunded orders are excluded.
    const paidOrders = orders.filter((o) =>
      !o.is_test_order && ['paid', 'partially_refunded'].includes(o.payment_status)
    );

    // Product sales — aggregated from each order's nested order_items rows
    const productMap = new Map<string, { name: string; revenue: number; qty: number }>();
    // Start with the entire pickle catalog so unsold products still have a zero bar.
    const pickleSales = PRODUCTS.filter(product => product.category === 'pickles')
      .map(product => ({ label: product.name, value: 0 }));
    const pickleByName = new Map(pickleSales.map(product => [product.label.toLowerCase(), product]));
    for (const o of paidOrders) {
      const items = Array.isArray(o.order_items) ? o.order_items : [];
      const grossRevenue = Number(o.total_price) || 0;
      const revenueRatio = grossRevenue > 0
        ? netOrderRevenue(o) / grossRevenue
        : 0;
      for (const item of items) {
        const key = item.product_name || 'Unknown';
        const pickle = pickleByName.get(key.trim().toLowerCase());
        const jars = Number(item.quantity);
        // Pickles are individual jars, independent of the sweets piece tiers.
        if (pickle && Number.isSafeInteger(jars) && jars > 0) pickle.value += jars;
        const lineTotal = (Number(item.line_total) || 0) * revenueRatio;
        const pieces = (Number(item.quantity) || 0) * (Number(item.selected_tier) || 1);
        const existing = productMap.get(key);
        if (existing) {
          existing.revenue += lineTotal;
          existing.qty += pieces;
        } else {
          productMap.set(key, { name: key, revenue: lineTotal, qty: pieces });
        }
      }
    }

    const productSales = Array.from(productMap.values())
      .sort((a, b) => b.revenue - a.revenue)
      .map((p) => ({ ...p, category: categoryForProduct(p.name), trend: p.revenue > 50 ? 'up' : p.revenue > 20 ? 'stable' : 'down' }));

    const { weeklyRevenue, monthlyRevenue, dayOfWeek } = getSalesTimeSeries(paidOrders);

    // Category revenue
    const catMap = new Map<string, number>();
    for (const p of productSales) {
      catMap.set(p.category, (catMap.get(p.category) || 0) + p.revenue);
    }
    const categoryRevenue = Array.from(catMap.entries()).map(([category, revenue]) => ({
      category,
      revenue,
    }));

    return {
      totalRevenue: paidOrders.reduce((s, o) => s + netOrderRevenue(o), 0),
      totalOrders: paidOrders.length,
      productSales,
      weeklyRevenue,
      monthlyRevenue,
      dayOfWeek,
      categoryRevenue,
      pickleSales,
    };
  }, [orders]);

  if (authLoading) {
    return (
      <div className="section-padding py-16 text-center">
        <p className="font-body text-brand-charcoal/60">Checking session...</p>
      </div>
    );
  }

  if (dataLoading) {
    return (
      <div className="section-padding py-16 text-center">
        <p className="font-body text-brand-charcoal/60">Loading analytics...</p>
      </div>
    );
  }

  if (!pinVerified) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center py-16">
        <div className="w-full max-w-xs mx-auto px-6 text-center space-y-6">
          <div className="w-16 h-16 bg-brand-cream rounded-full flex items-center justify-center mx-auto">
            <Lock size={28} className="text-brand-maroon" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold text-brand-charcoal">
              Analytics Protected
            </h1>
            <p className="font-body text-sm text-brand-charcoal/60 mt-1">
              Enter your PIN to view sales analytics
            </p>
          </div>
          <div className="space-y-3">
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, ''));
                setPinError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  verifyPin();
                }
              }}
              className="input-field text-center text-2xl tracking-[0.5em] font-mono"
              placeholder="••••••"
              autoFocus
            />
            {pinError && (
              <p className="font-body text-sm text-red-600">{pinError}</p>
            )}
            <button
              onClick={verifyPin}
              className="btn-primary w-full"
            >
              Unlock Analytics
            </button>
            <Link
              href="/admin/dashboard"
              className="block font-body text-xs text-brand-charcoal/40 hover:text-brand-maroon transition-colors"
            >
              ← Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (dataError) {
    return (
      <div className="section-padding py-16 text-center space-y-4">
        <p role="alert" className="font-body text-red-700">{dataError}</p>
        <button className="btn-primary" onClick={() => setLoadAttempt(attempt => attempt + 1)}>Try again</button>
        <Link href="/admin/dashboard" className="block text-sm underline">Back to dashboard</Link>
      </div>
    );
  }

  return (
    <div className="section-padding py-8 sm:py-12">
      <div className="flex items-center gap-3 mb-8">
        <Link
          href="/admin/dashboard"
          className="p-2 rounded-lg hover:bg-brand-cream transition-colors"
        >
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-brand-charcoal">
            Sales Analytics
          </h1>
          <p className="font-body text-sm text-brand-charcoal/50">
            Performance insights and trends
          </p>
        </div>
      </div>

      {orders.some(order => order.is_test_order) && (
        <p className="font-body text-sm text-brand-charcoal/60 mb-6">Owner-confirmed test orders are excluded from all sales totals and charts.</p>
      )}
      {analytics.totalOrders === 0 && (
        <p className="font-body text-sm text-brand-charcoal/60 mb-6">No paid orders to display yet.</p>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="card p-5">
          <DollarSign size={20} className="text-brand-gold mb-2" />
          <p className="font-display text-2xl font-bold text-brand-charcoal">
            {formatCurrency(analytics.totalRevenue)}
          </p>
          <p className="font-body text-xs text-brand-charcoal/50">Total Revenue</p>
        </div>
        <div className="card p-5">
          <ShoppingBag size={20} className="text-brand-maroon mb-2" />
          <p className="font-display text-2xl font-bold text-brand-charcoal">
            {analytics.totalOrders}
          </p>
          <p className="font-body text-xs text-brand-charcoal/50">Total Orders</p>
        </div>
        <div className="card p-5">
          <TrendingUp size={20} className="text-green-500 mb-2" />
          <p className="font-display text-2xl font-bold text-brand-charcoal">
            {analytics.productSales[0]?.name || '—'}
          </p>
          <p className="font-body text-xs text-brand-charcoal/50">Highest Demand</p>
        </div>
        <div className="card p-5">
          <TrendingDown size={20} className="text-red-400 mb-2" />
          <p className="font-display text-2xl font-bold text-brand-charcoal">
            {analytics.productSales[analytics.productSales.length - 1]?.name || '—'}
          </p>
          <p className="font-body text-xs text-brand-charcoal/50">Lowest Demand</p>
        </div>
      </div>

      <div className="space-y-6 mb-8">
        {/* Weekly Revenue */}
        <div className="card p-5">
          <h3 className="font-display text-base font-semibold text-brand-charcoal mb-4">
            Weekly Revenue
          </h3>
          <p className="font-body text-xs text-brand-charcoal/60 mb-4">Last 52 weeks · Monday–Sunday · US Central time</p>
          <AnalyticsBarChart label="Weekly Revenue" data={analytics.weeklyRevenue}
            formatValue={formatCurrency} barClassName="bg-brand-maroon/80" weekly minimumWidth={1248} />
        </div>

        {/* Monthly Revenue */}
        <div className="card p-5">
          <h3 className="font-display text-base font-semibold text-brand-charcoal mb-4">
            Monthly Revenue
          </h3>
          <p className="font-body text-xs text-brand-charcoal/60 mb-4">Last 12 calendar months · US Central time</p>
          <AnalyticsBarChart label="Monthly Revenue" data={analytics.monthlyRevenue}
            formatValue={formatCurrency} barClassName="bg-brand-gold" minimumWidth={720} />
        </div>
      </div>

      <div className="card p-5 mb-8">
        <h3 className="font-display text-base font-semibold text-brand-charcoal mb-4">Pickle Sales by Product</h3>
        <p className="font-body text-xs text-brand-charcoal/60 mb-4">Jars sold · Paid and partially refunded orders</p>
        <AnalyticsBarChart label="Pickle Sales by Product" data={analytics.pickleSales}
          formatValue={value => `${value} ${value === 1 ? 'jar' : 'jars'}`}
          barClassName="bg-brand-green/80" wrapLabels />
      </div>

      <div className="grid lg:grid-cols-2 gap-6 mb-8">
        {/* Day of Week */}
        <div className="card p-5">
          <h3 className="font-display text-base font-semibold text-brand-charcoal mb-4">
            Orders by Day of Week
          </h3>
          <p className="font-body text-xs text-brand-charcoal/60 mb-4">Order dates in US Central time</p>
          <AnalyticsBarChart label="Orders by Day of Week"
            data={analytics.dayOfWeek.map(day => ({ label: day.day, value: day.orders }))}
            formatValue={value => String(value)} barClassName="bg-brand-green/70" />
        </div>

        {/* Category Revenue */}
        <div className="card p-5">
          <h3 className="font-display text-base font-semibold text-brand-charcoal mb-4">
            Revenue by Category
          </h3>
          <div className="space-y-3">
            {analytics.categoryRevenue.map((c) => {
              const maxCat = Math.max(...analytics.categoryRevenue.map((x) => x.revenue), 1);
              return (
                <div key={c.category}>
                  <div className="flex justify-between font-body text-xs mb-1">
                    <span className="capitalize">{c.category}</span>
                    <span className="font-medium">{formatCurrency(c.revenue)}</span>
                  </div>
                  <div className="w-full bg-brand-cream rounded-full h-2">
                    <div
                      className="bg-brand-maroon h-2 rounded-full transition-all"
                      style={{ width: `${(c.revenue / maxCat) * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Product Performance */}
      <div className="card p-5">
        <h3 className="font-display text-base font-semibold text-brand-charcoal mb-4">
          Product Performance
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-brand-cream-dark">
                {['Product', 'Units Sold', 'Revenue', 'Trend'].map((h) => (
                  <th
                    key={h}
                    className="font-body text-xs font-semibold text-brand-charcoal/50 uppercase py-2 px-2"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {analytics.productSales.map((p, i) => (
                <tr key={i} className="border-b border-brand-cream-dark/50">
                  <td className="py-2 px-2 font-body text-sm font-medium">{p.name}</td>
                  <td className="py-2 px-2 font-body text-sm">{p.qty}</td>
                  <td className="py-2 px-2 font-body text-sm">{formatCurrency(p.revenue)}</td>
                  <td className="py-2 px-2">
                    {p.trend === 'up' ? (
                      <TrendingUp size={14} className="text-green-500" />
                    ) : p.trend === 'down' ? (
                      <TrendingDown size={14} className="text-red-400" />
                    ) : (
                      <Minus size={14} className="text-gray-400" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recommendations */}
      <div className="card p-5 mt-6 bg-brand-cream border-brand-gold/20">
        <h3 className="font-display text-base font-semibold text-brand-charcoal mb-3">
          Growth Recommendations
        </h3>
        <div className="space-y-2 font-body text-sm text-brand-charcoal/70">
          <p>
            • Focus marketing on your top-performing products to maximize revenue.
          </p>
          <p>
            • Consider bundle promotions for lower-demand items to boost their sales.
          </p>
          <p>
            • Analyze peak ordering days and align social media campaigns accordingly.
          </p>
          <p>
            • Expand gift box offerings during festival seasons for higher average order value.
          </p>
          <p>
            • Track week-over-week trends to identify seasonal patterns and plan production.
          </p>
        </div>
      </div>
    </div>
  );
}
