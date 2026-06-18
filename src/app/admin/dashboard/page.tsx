'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  LogOut,
  BarChart3,
  Package,
  Filter,
  ChefHat,
  RefreshCw,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import type { OrderRecord } from '@/types';

interface ProductionItem {
  name: string;
  quantity: number;
  unit: string;
}

type FilterType = 'today' | 'tomorrow' | 'future' | 'completed' | 'all';

export default function AdminDashboardPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [filter, setFilter] = useState<FilterType>('today');
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(false);

  // Check auth (middleware handles redirect, this is for UI state)
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
      }
    };
    checkAuth();
  }, [router]);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/orders?filter=${filter}`);
      const data = await res.json();
      setOrders(data.orders || []);
    } catch (e) {
      console.error('Failed to fetch orders:', e);
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    if (authed) fetchOrders();
  }, [authed, fetchOrders]);

  const handleLogout = async () => {
    await fetch('/api/auth', { method: 'DELETE' });
    router.push('/admin/login');
  };

  // Production summary — counts paid orders by type for the current filter
  const productionRequirements = useCallback((): ProductionItem[] => {
    const map = new Map<string, ProductionItem>();

    for (const order of orders) {
      // Only paid orders contribute to production requirements
      if (order.payment_status !== 'paid') continue;

      const label = order.order_type === 'pickup'
        ? `Pickup — ${order.pickup_location || 'TBD'}`
        : `Delivery — ${order.delivery_address?.split('\n')[0] || 'TBD'}`;

      if (map.has(order.order_type)) {
        map.get(order.order_type)!.quantity += 1;
      } else {
        map.set(order.order_type, {
          name: order.order_type === 'pickup' ? 'Pickup Orders' : 'Delivery Orders',
          quantity: 1,
          unit: 'orders',
        });
      }

      // Suppress unused variable warning
      void label;
    }

    return Array.from(map.values()).sort((a, b) => b.quantity - a.quantity);
  }, [orders]);

  if (!authed) {
    return (
      <div className="section-padding py-16 text-center">
        <p className="font-body text-brand-charcoal/60">Checking authentication...</p>
      </div>
    );
  }

  const production = productionRequirements();
  const FILTERS: { key: FilterType; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'tomorrow', label: 'Tomorrow' },
    { key: 'future', label: 'Future' },
    { key: 'completed', label: 'Completed' },
    { key: 'all', label: 'All' },
  ];

  return (
    <div className="section-padding py-8 sm:py-12">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-brand-charcoal">
            Admin Dashboard
          </h1>
          <p className="font-body text-sm text-brand-charcoal/50">
            Manage orders and production
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/admin/analytics"
            className="btn-secondary text-xs gap-1.5"
          >
            <BarChart3 size={14} /> Analytics
          </Link>
          <button onClick={handleLogout} className="btn-secondary text-xs gap-1.5">
            <LogOut size={14} /> Logout
          </button>
        </div>
      </div>

      {/* Production Requirements */}
      {production.length > 0 && (
        <div className="card p-6 mb-8">
          <div className="flex items-center gap-2 mb-4">
            <ChefHat size={20} className="text-brand-gold" />
            <h2 className="font-display text-lg font-semibold text-brand-charcoal">
              Production Required ({filter === 'today' ? 'Today' : filter})
            </h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {production.map((item, i) => (
              <div
                key={i}
                className="bg-brand-cream rounded-lg p-3 text-center"
              >
                <p className="font-display text-xl font-bold text-brand-maroon">
                  {item.quantity}
                </p>
                <p className="font-body text-xs text-brand-charcoal/60">
                  {item.unit}
                </p>
                <p className="font-body text-sm font-medium text-brand-charcoal mt-1">
                  {item.name}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <Filter size={16} className="text-brand-charcoal/40" />
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3 py-1.5 rounded-full font-body text-xs font-medium transition-colors ${
              filter === key
                ? 'bg-brand-maroon text-white'
                : 'bg-brand-cream text-brand-charcoal/60 hover:bg-brand-cream-dark'
            }`}
          >
            {label}
          </button>
        ))}
        <button
          onClick={fetchOrders}
          className="p-1.5 rounded-full hover:bg-brand-cream transition-colors ml-auto"
          aria-label="Refresh"
        >
          <RefreshCw size={16} className="text-brand-charcoal/40" />
        </button>
      </div>

      {/* Orders table */}
      {loading ? (
        <div className="text-center py-12">
          <p className="font-body text-brand-charcoal/40">Loading orders...</p>
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-12">
          <Package size={36} className="mx-auto text-brand-charcoal/20 mb-3" />
          <p className="font-body text-brand-charcoal/40">
            No orders found for this filter.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-brand-cream-dark">
                {[
                  'Order #',
                  'Customer',
                  'Products',
                  'Qty',
                  'Type',
                  'Date/Location',
                  'Total',
                  'Payment',
                  'Status',
                ].map((h) => (
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
              {orders.map((order) => (
                  <tr
                    key={order.id}
                    className="border-b border-brand-cream-dark/50 hover:bg-brand-cream/50 transition-colors"
                  >
                    <td className="py-3 px-2 font-body text-xs font-medium text-brand-maroon">
                      {order.order_number}
                    </td>
                    <td className="py-3 px-2 font-body text-xs">
                      {order.customer_name || '—'}
                      <br />
                      <span className="text-brand-charcoal/40">{order.phone_number || ''}</span>
                    </td>
                    <td className="py-3 px-2 font-body text-xs max-w-[140px] text-brand-charcoal/60">
                      —
                    </td>
                    <td className="py-3 px-2 font-body text-xs text-brand-charcoal/60">
                      —
                    </td>
                    <td className="py-3 px-2">
                      <span
                        className={`font-body text-xs px-2 py-0.5 rounded-full ${
                          order.order_type === 'pickup'
                            ? 'bg-blue-50 text-blue-700'
                            : 'bg-green-50 text-green-700'
                        }`}
                      >
                        {order.order_type === 'pickup' ? 'Pickup' : 'Delivery'}
                      </span>
                    </td>
                    <td className="py-3 px-2 font-body text-xs text-brand-charcoal/60">
                      {order.order_type === 'pickup' ? (
                        <>
                          {order.pickup_date || '—'}
                          <br />
                          {order.pickup_location || '—'}
                        </>
                      ) : (
                        <span className="whitespace-pre-line">
                          {order.delivery_address || '—'}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-2 font-body text-xs font-medium">
                      {formatCurrency(order.total_price)}
                    </td>
                    <td className="py-3 px-2">
                      <span
                        className={`font-body text-xs px-2 py-0.5 rounded-full ${
                          order.payment_status === 'paid'
                            ? 'bg-green-50 text-green-700'
                            : 'bg-amber-50 text-amber-700'
                        }`}
                      >
                        {order.payment_status}
                      </span>
                    </td>
                    <td className="py-3 px-2 font-body text-xs text-brand-charcoal/50">
                      {order.status}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
