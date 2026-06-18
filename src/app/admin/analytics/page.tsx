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
import type { OrderRecord } from '@/types';

/** Resolve a product's category from the catalog by name (order_items store name only). */
function categoryForProduct(name: string): string {
  return PRODUCTS.find((p) => p.name === name)?.category || 'other';
}

export default function AnalyticsPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [authLoading, setAuthLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
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
    const fetchAll = async () => {
      setDataLoading(true);
      const res = await fetch('/api/orders?filter=all');
      const data = await res.json();
      setOrders(data.orders || []);
      setDataLoading(false);
    };
    fetchAll();
  }, [authed, pinVerified]);

  const analytics = useMemo(() => {
    if (orders.length === 0)
      return {
        totalRevenue: 0,
        totalOrders: 0,
        productSales: [] as { name: string; revenue: number; qty: number; trend: string }[],
        weeklyRevenue: [] as { label: string; value: number }[],
        monthlyRevenue: [] as { label: string; value: number }[],
        dayOfWeek: [] as { day: string; orders: number }[],
        categoryRevenue: [] as { category: string; revenue: number }[],
      };

    const paidOrders = orders.filter((o) => o.payment_status === 'paid');

    // Product sales — aggregated from each order's nested order_items rows
    const productMap = new Map<string, { name: string; revenue: number; qty: number }>();
    for (const o of paidOrders) {
      const items = Array.isArray(o.order_items) ? o.order_items : [];
      for (const item of items) {
        const key = item.product_name || 'Unknown';
        const lineTotal = Number(item.line_total) || 0;
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

    // Weekly revenue (last 8 weeks)
    const weeklyRevenue: { label: string; value: number }[] = [];
    for (let w = 7; w >= 0; w--) {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - w * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);
      const label = `W-${w === 0 ? 'now' : w}`;
      const value = paidOrders
        .filter((o) => {
          const d = new Date(o.created_at);
          return d >= weekStart && d < weekEnd;
        })
        .reduce((s, o) => s + (Number(o.total_price) || 0), 0);
      weeklyRevenue.push({ label, value });
    }

    // Monthly revenue (last 6 months)
    const monthlyRevenue: { label: string; value: number }[] = [];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    for (let m = 5; m >= 0; m--) {
      const date = new Date();
      date.setMonth(date.getMonth() - m);
      const label = monthNames[date.getMonth()];
      const value = paidOrders
        .filter((o) => {
          const d = new Date(o.created_at);
          return d.getMonth() === date.getMonth() && d.getFullYear() === date.getFullYear();
        })
        .reduce((s, o) => s + (Number(o.total_price) || 0), 0);
      monthlyRevenue.push({ label, value });
    }

    // Day of week
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayMap = new Map<number, number>();
    for (const o of paidOrders) {
      const day = new Date(o.created_at).getDay();
      dayMap.set(day, (dayMap.get(day) || 0) + 1);
    }
    const dayOfWeek = dayNames.map((day, i) => ({ day, orders: dayMap.get(i) || 0 }));

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
      totalRevenue: paidOrders.reduce((s, o) => s + (Number(o.total_price) || 0), 0),
      totalOrders: paidOrders.length,
      productSales,
      weeklyRevenue,
      monthlyRevenue,
      dayOfWeek,
      categoryRevenue,
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

  const maxWeekly = Math.max(...analytics.weeklyRevenue.map((w) => w.value), 1);
  const maxMonthly = Math.max(...analytics.monthlyRevenue.map((m) => m.value), 1);
  const maxDay = Math.max(...analytics.dayOfWeek.map((d) => d.orders), 1);

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

      <div className="grid lg:grid-cols-2 gap-6 mb-8">
        {/* Weekly Revenue */}
        <div className="card p-5">
          <h3 className="font-display text-base font-semibold text-brand-charcoal mb-4">
            Weekly Revenue
          </h3>
          <div className="flex items-end gap-2 h-40">
            {analytics.weeklyRevenue.map((w, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full bg-brand-maroon/80 rounded-t transition-all"
                  style={{ height: `${(w.value / maxWeekly) * 100}%`, minHeight: '4px' }}
                />
                <span className="font-body text-[10px] text-brand-charcoal/40">
                  {w.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Monthly Revenue */}
        <div className="card p-5">
          <h3 className="font-display text-base font-semibold text-brand-charcoal mb-4">
            Monthly Revenue
          </h3>
          <div className="flex items-end gap-3 h-40">
            {analytics.monthlyRevenue.map((m, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full bg-brand-gold rounded-t transition-all"
                  style={{ height: `${(m.value / maxMonthly) * 100}%`, minHeight: '4px' }}
                />
                <span className="font-body text-[10px] text-brand-charcoal/40">
                  {m.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6 mb-8">
        {/* Day of Week */}
        <div className="card p-5">
          <h3 className="font-display text-base font-semibold text-brand-charcoal mb-4">
            Orders by Day of Week
          </h3>
          <div className="flex items-end gap-2 h-32">
            {analytics.dayOfWeek.map((d, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full bg-brand-green/70 rounded-t transition-all"
                  style={{ height: `${(d.orders / maxDay) * 100}%`, minHeight: '4px' }}
                />
                <span className="font-body text-[10px] text-brand-charcoal/40">
                  {d.day}
                </span>
              </div>
            ))}
          </div>
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
