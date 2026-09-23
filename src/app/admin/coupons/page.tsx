'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Plus,
  Users,
  TrendingUp,
  Truck,
  MapPin,
  Gift,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { isValidCouponMinimum, type CouponType } from '@/lib/coupons';

interface Coupon {
  code: string;
  influencer_name: string;
  coupon_type: CouponType;
  min_subtotal: number;
  bonus_item: string;
  bonus_qty: number;
  times_used: number;
  active: number;
  created_at: string;
}

interface CouponAnalytics {
  code: string;
  order_count: number;
  total_revenue: number;
  pickup_orders: number;
  delivery_orders: number;
  pickup_revenue: number;
  delivery_revenue: number;
}

export default function CouponsPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [analytics, setAnalytics] = useState<CouponAnalytics[]>([]);
  const [loading, setLoading] = useState(true);

  // New coupon form
  const [showForm, setShowForm] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newInfluencer, setNewInfluencer] = useState('');
  const [newType, setNewType] = useState<CouponType>('complimentary');
  const [newMinimum, setNewMinimum] = useState('0');
  const [minimumEdits, setMinimumEdits] = useState<Record<string, string>>({});
  const [savingMinimum, setSavingMinimum] = useState<string | null>(null);
  const [rowError, setRowError] = useState('');
  const [newBonusItem, setNewBonusItem] = useState('Malai Khaja');
  const [newBonusQty, setNewBonusQty] = useState(2);
  const [formError, setFormError] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch('/api/auth');
        if (res.ok) setAuthed(true);
        else router.push('/admin/login');
      } catch {
        router.push('/admin/login');
      }
    };
    checkAuth();
  }, [router]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/coupons/admin');
      const data = await res.json();
      setCoupons(data.coupons || []);
      setAnalytics(data.analytics || []);
    } catch (e) {
      console.error('Failed to fetch coupons:', e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (authed) fetchData();
  }, [authed, fetchData]);

  const analyticsMap = useMemo(() => {
    const map = new Map<string, CouponAnalytics>();
    for (const a of analytics) map.set(a.code, a);
    return map;
  }, [analytics]);

  const totals = useMemo(() => {
    let orders = 0, revenue = 0, pickup = 0, delivery = 0;
    for (const a of analytics) {
      orders += Number(a.order_count) || 0;
      revenue += Number(a.total_revenue) || 0;
      pickup += Number(a.pickup_orders) || 0;
      delivery += Number(a.delivery_orders) || 0;
    }
    return { orders, revenue, pickup, delivery };
  }, [analytics]);

  const handleCreate = async () => {
    setFormError('');
    if (!newCode.trim() || !newInfluencer.trim()) {
      setFormError('Code and influencer or campaign name are required.');
      return;
    }
    if (newType === 'free_delivery' && (!newMinimum.trim() || !isValidCouponMinimum(Number(newMinimum)))) {
      setFormError('Enter a minimum cart value of $0 or more, with up to two decimal places.');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/coupons/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: newCode,
          influencerName: newInfluencer,
          bonusItem: newBonusItem,
          bonusQty: newBonusQty,
          type: newType,
          minSubtotal: newType === 'free_delivery' ? Number(newMinimum) : 0,
        }),
      });
      if (res.ok) {
        setNewCode('');
        setNewInfluencer('');
        setNewBonusItem('Malai Khaja');
        setNewBonusQty(2);
        setNewType('complimentary');
        setNewMinimum('0');
        setShowForm(false);
        await fetchData();
      } else {
        const err = await res.json().catch(() => ({}));
        setFormError(err.error || 'Failed to create coupon.');
      }
    } catch {
      setFormError('Network error. Please try again.');
    }
    setCreating(false);
  };

  const handleToggle = async (code: string, currentActive: number) => {
    try {
      await fetch('/api/coupons/admin', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, active: currentActive ? 0 : 1 }),
      });
      await fetchData();
    } catch (e) {
      console.error('Toggle failed:', e);
    }
  };

  const handleMinimumSave = async (coupon: Coupon) => {
    const value = minimumEdits[coupon.code] ?? String(coupon.min_subtotal);
    setRowError('');
    if (!value.trim() || !isValidCouponMinimum(Number(value))) {
      setRowError(`${coupon.code}: enter a minimum cart value of $0 or more, with up to two decimal places.`);
      return;
    }
    setSavingMinimum(coupon.code);
    try {
      const res = await fetch('/api/coupons/admin', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: coupon.code, minSubtotal: Number(value) }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || 'Could not save the minimum cart value.');
      }
      setCoupons(previous => previous.map(row => row.code === coupon.code ? { ...row, min_subtotal: Number(value) } : row));
      setMinimumEdits(previous => { const next = { ...previous }; delete next[coupon.code]; return next; });
    } catch (error) {
      setRowError(error instanceof Error ? error.message : 'Could not save the minimum cart value.');
    } finally {
      setSavingMinimum(null);
    }
  };

  if (!authed) {
    return (
      <div className="section-padding py-16 text-center">
        <p className="font-body text-brand-charcoal/60">Checking authentication...</p>
      </div>
    );
  }

  return (
    <div className="section-padding py-8 sm:py-12">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <Link
          href="/admin/dashboard"
          className="p-2 rounded-lg hover:bg-brand-cream transition-colors"
        >
          <ArrowLeft size={18} />
        </Link>
        <div className="flex-1">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-brand-charcoal">
            Coupons
          </h1>
          <p className="font-body text-sm text-brand-charcoal/50">
            Choose coupon benefits and track campaign performance
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="btn-primary text-xs gap-1.5"
        >
          <Plus size={14} /> New Coupon
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="card p-5 mb-6 space-y-4">
          <h3 className="font-display text-base font-semibold text-brand-charcoal">
            Create New Coupon
          </h3>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="label-text">Coupon Code</label>
              <input
                type="text"
                value={newCode}
                onChange={(e) => setNewCode(e.target.value.toUpperCase().replace(/\s/g, ''))}
                placeholder="e.g. FOODIE2026"
                className="input-field"
              />
            </div>
            <div>
              <label className="label-text">Influencer / Campaign Name</label>
              <input
                type="text"
                value={newInfluencer}
                onChange={(e) => setNewInfluencer(e.target.value)}
                placeholder="e.g. Priya Eats"
                className="input-field"
              />
            </div>
            <div>
              <label htmlFor="coupon-benefit" className="label-text">Coupon benefit</label>
              <select id="coupon-benefit" value={newType} onChange={e => setNewType(e.target.value as CouponType)} className="input-field">
                <option value="complimentary">Complimentary pieces</option>
                <option value="free_delivery">Shipping offer — free in Texas</option>
              </select>
            </div>
            {newType === 'free_delivery' ? (
              <div>
                <label htmlFor="coupon-minimum" className="label-text">Minimum cart value ($)</label>
                <input id="coupon-minimum" type="number" min="0" step="0.01" value={newMinimum}
                  onChange={e => setNewMinimum(e.target.value)} className="input-field" />
                <p className="font-body text-xs text-brand-charcoal/60 mt-1">Merchandise subtotal before tax and shipping. Enter 0 for no minimum.</p>
              </div>
            ) : (
              <>
                <div>
                  <label htmlFor="coupon-bonus-item" className="label-text">Complimentary item</label>
                  <select id="coupon-bonus-item" value={newBonusItem} onChange={e => setNewBonusItem(e.target.value)} className="input-field">
                    <option value="Malai Khaja">Malai Khaja</option>
                    <option value="Malpuri">Malpuri</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="coupon-bonus-qty" className="label-text">Complimentary pieces</label>
                  <input id="coupon-bonus-qty" type="number" min={1} max={10} step={1} value={newBonusQty}
                    onChange={e => setNewBonusQty(Number(e.target.value))} className="input-field" />
                </div>
              </>
            )}
          </div>
          {newType === 'free_delivery' && <p className="font-body text-xs text-brand-charcoal/70">At the minimum: free shipping in Texas. Pickle-only orders ship for $3.99 elsewhere; other orders get $4 off nearby-state shipping or $3 off far-state shipping. Existing destination minimums still apply.</p>}
          {formError && (
            <p className="font-body text-sm text-red-600">{formError}</p>
          )}
          <div className="flex gap-3">
            <button
              onClick={handleCreate}
              disabled={creating}
              className="btn-primary text-sm"
            >
              {creating ? 'Creating...' : 'Create Coupon'}
            </button>
            <button
              onClick={() => { setShowForm(false); setFormError(''); }}
              className="btn-secondary text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* KPI Cards */}
      {analytics.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="card p-5">
            <Users size={20} className="text-brand-gold mb-2" />
            <p className="font-display text-2xl font-bold text-brand-charcoal">
              {coupons.length}
            </p>
            <p className="font-body text-xs text-brand-charcoal/50">Active Influencers</p>
          </div>
          <div className="card p-5">
            <TrendingUp size={20} className="text-green-500 mb-2" />
            <p className="font-display text-2xl font-bold text-brand-charcoal">
              {formatCurrency(totals.revenue)}
            </p>
            <p className="font-body text-xs text-brand-charcoal/50">Total Revenue Driven</p>
          </div>
          <div className="card p-5">
            <MapPin size={20} className="text-blue-500 mb-2" />
            <p className="font-display text-2xl font-bold text-brand-charcoal">
              {totals.pickup}
            </p>
            <p className="font-body text-xs text-brand-charcoal/50">Pickup Orders</p>
          </div>
          <div className="card p-5">
            <Truck size={20} className="text-brand-maroon mb-2" />
            <p className="font-display text-2xl font-bold text-brand-charcoal">
              {totals.delivery}
            </p>
            <p className="font-body text-xs text-brand-charcoal/50">Delivery Orders</p>
          </div>
        </div>
      )}

      {/* Influencer Performance Table */}
      {loading ? (
        <div className="text-center py-12">
          <p className="font-body text-brand-charcoal/40">Loading coupons...</p>
        </div>
      ) : coupons.length === 0 ? (
        <div className="text-center py-12">
          <Gift size={36} className="mx-auto text-brand-charcoal/20 mb-3" />
          <p className="font-body text-brand-charcoal/40">
            No coupons created yet. Click &quot;New Coupon&quot; to get started.
          </p>
        </div>
      ) : (
        <div className="card p-5">
          <h3 className="font-display text-base font-semibold text-brand-charcoal mb-4">
            Influencer Performance
          </h3>
          <p className="font-body text-xs text-brand-charcoal/60 mb-3">The shipping offer requires this merchandise subtotal before tax and shipping. Updated minimums apply when customers continue to payment.</p>
          {rowError && <p role="alert" className="font-body text-sm text-red-600 mb-3">{rowError}</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-brand-cream-dark">
                  {['Code', 'Influencer / Campaign', 'Benefit', 'Minimum cart value', 'Orders', 'Revenue', 'Pickup', 'Delivery', 'Status'].map((h) => (
                    <th
                      key={h}
                      className="font-body text-xs font-semibold text-brand-charcoal/50 uppercase tracking-wider py-3 px-2"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {coupons.map((coupon) => {
                  const stats = analyticsMap.get(coupon.code);
                  return (
                    <tr
                      key={coupon.code}
                      className="border-b border-brand-cream-dark/50 hover:bg-brand-cream/50 transition-colors"
                    >
                      <td className="py-3 px-2 font-body text-sm font-medium text-brand-maroon">
                        {coupon.code}
                      </td>
                      <td className="py-3 px-2 font-body text-sm">
                        {coupon.influencer_name}
                      </td>
                      <td className="py-3 px-2 font-body text-xs text-brand-charcoal/60">
                        {coupon.coupon_type === 'free_delivery' ? 'Shipping offer' : `${coupon.bonus_qty}× ${coupon.bonus_item}`}
                      </td>
                      <td className="py-3 px-2 font-body text-xs">
                        {coupon.coupon_type === 'free_delivery' ? (
                          <div className="flex items-center gap-2">
                            <span>$</span>
                            <input type="number" min="0" step="0.01" aria-label={`Minimum cart value for ${coupon.code}`}
                              className="input-field w-24" disabled={savingMinimum === coupon.code}
                              value={minimumEdits[coupon.code] ?? String(coupon.min_subtotal)}
                              onChange={e => setMinimumEdits(previous => ({ ...previous, [coupon.code]: e.target.value }))} />
                            <button type="button" className="btn-secondary text-xs" aria-label={`Save minimum for ${coupon.code}`}
                              disabled={savingMinimum !== null || minimumEdits[coupon.code] === undefined}
                              onClick={() => handleMinimumSave(coupon)}>
                              {savingMinimum === coupon.code ? 'Saving…' : 'Save'}
                            </button>
                          </div>
                        ) : '—'}
                      </td>
                      <td className="py-3 px-2 font-body text-sm font-medium">
                        {stats ? Number(stats.order_count) : 0}
                      </td>
                      <td className="py-3 px-2 font-body text-sm font-medium">
                        {stats ? formatCurrency(Number(stats.total_revenue)) : '$0.00'}
                      </td>
                      <td className="py-3 px-2 font-body text-xs text-brand-charcoal/60">
                        {stats ? `${stats.pickup_orders} (${formatCurrency(Number(stats.pickup_revenue))})` : '0'}
                      </td>
                      <td className="py-3 px-2 font-body text-xs text-brand-charcoal/60">
                        {stats ? `${stats.delivery_orders} (${formatCurrency(Number(stats.delivery_revenue))})` : '0'}
                      </td>
                      <td className="py-3 px-2">
                        <button
                          onClick={() => handleToggle(coupon.code, coupon.active)}
                          className={`font-body text-xs px-3 py-1 rounded-full transition-colors ${
                            coupon.active
                              ? 'bg-green-50 text-green-700 hover:bg-green-100'
                              : 'bg-red-50 text-red-600 hover:bg-red-100'
                          }`}
                        >
                          {coupon.active ? 'Active' : 'Disabled'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
