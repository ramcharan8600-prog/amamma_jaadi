'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  LogOut,
  BarChart3,
  Package,
  Filter,
  ChefHat,
  RefreshCw,
  Ticket,
  Save,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { d1TimestampToBusinessDate } from '@/lib/date';
import { shippingMethodLabel } from '@/lib/pricing';
import { PICKUP_LOCATIONS } from '@/data/products';
import InventoryPanel from '@/components/admin/InventoryPanel';
import SoldOutDatesPanel from '@/components/admin/SoldOutDatesPanel';
import type { OrderRecord, ShipmentStatus } from '@/types';

interface ProductionItem {
  name: string;
  quantity: number;
  unit: string;
}

type FilterType = 'today' | 'tomorrow' | 'future' | 'completed' | 'all';
/** Location filter value for every delivery order (pickup location ids never use it). */
const DELIVERY_ORDERS = 'delivery';
type ShipmentColumnFilter = 'all' | 'pickup' | ShipmentStatus;

/** Orders shown per page in the orders table (the server pages through all of them). */
const ORDERS_PER_PAGE = 25;

/** Page buttons to show: first, last and two either side of the current page, with gaps. */
function pageNumbers(current: number, count: number): Array<number | 'gap'> {
  const pages: Array<number | 'gap'> = [];
  for (let page = 1; page <= count; page++) {
    if (page === 1 || page === count || Math.abs(page - current) <= 2) pages.push(page);
    else if (pages.at(-1) !== 'gap') pages.push('gap');
  }
  return pages;
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  // Orders matching the filters across all pages, and what they need.
  const [totalOrders, setTotalOrders] = useState(0);
  const [production, setProduction] = useState<ProductionItem[]>([]);
  const [filter, setFilter] = useState<FilterType>('today');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dateFilter, setDateFilter] = useState('');
  const [shipmentFilter, setShipmentFilter] = useState<ShipmentColumnFilter>('all');
  const [pickupLocationFilter, setPickupLocationFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [shipmentDrafts, setShipmentDrafts] = useState<
    Record<string, { shipmentStatus: ShipmentStatus; trackingId: string }>
  >({});
  const [savingOrderId, setSavingOrderId] = useState<string | null>(null);
  const [savedOrderId, setSavedOrderId] = useState<string | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const [allChangesSaved, setAllChangesSaved] = useState(false);
  const latestOrderRequest = useRef(0);

  const dirtyOrders = useMemo(
    () => orders.filter((order) => {
      if (order.order_type !== 'delivery') return false;
      const draft = shipmentDrafts[order.id];
      if (!draft) return false;
      return (
        draft.shipmentStatus !== (order.shipment_status || 'yet_to_ship') ||
        draft.trackingId.trim() !== (order.tracking_id || '')
      );
    }),
    [orders, shipmentDrafts]
  );

  const filteredOrders = useMemo(
    () => orders.filter((order) => {
      const orderDate = order.order_type === 'pickup'
        ? order.pickup_date
        : d1TimestampToBusinessDate(order.created_at);
      if (dateFilter && orderDate !== dateFilter) return false;

      if (shipmentFilter === 'pickup') {
        if (order.order_type !== 'pickup') return false;
      } else if (shipmentFilter !== 'all') {
        if (
          order.order_type !== 'delivery' ||
          (order.shipment_status || 'yet_to_ship') !== shipmentFilter
        ) return false;
      }

      if (pickupLocationFilter === DELIVERY_ORDERS) {
        if (order.order_type !== 'delivery') return false;
      } else if (pickupLocationFilter && order.pickup_location !== pickupLocationFilter) return false;
      return true;
    }),
    [orders, dateFilter, shipmentFilter, pickupLocationFilter]
  );

  const activeColumnFilterCount = [dateFilter, shipmentFilter !== 'all', pickupLocationFilter]
    .filter(Boolean).length;

  // The server sends one page at a time; any filter change starts again at page 1.
  const filterKey = [filter, dateFilter, shipmentFilter, pickupLocationFilter].join('|');
  const [pageState, setPageState] = useState({ key: filterKey, page: 1 });
  const pageCount = Math.max(1, Math.ceil(totalOrders / ORDERS_PER_PAGE));
  const currentPage = pageState.key === filterKey ? pageState.page : 1;
  const pageStart = (currentPage - 1) * ORDERS_PER_PAGE;
  const pageOrders = filteredOrders;
  const tableTop = useRef<HTMLDivElement>(null);
  const goToPage = (page: number) => {
    if (!canChangeView()) return;
    setPageState({ key: filterKey, page });
    tableTop.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

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

  // The filters as query parameters, shared by the order page and production summary.
  const filterParams = useMemo(() => {
    const params = new URLSearchParams({ filter });
    if (dateFilter) params.set('date', dateFilter);
    if (shipmentFilter !== 'all') params.set('shipmentStatus', shipmentFilter);
    if (pickupLocationFilter) params.set('pickupLocation', pickupLocationFilter);
    return params.toString();
  }, [filter, dateFilter, shipmentFilter, pickupLocationFilter]);

  const fetchOrders = useCallback(async () => {
    const requestId = latestOrderRequest.current + 1;
    latestOrderRequest.current = requestId;
    setLoading(true);
    try {
      const params = new URLSearchParams(filterParams);
      params.set('page', String(currentPage));
      params.set('pageSize', String(ORDERS_PER_PAGE));

      const res = await fetch(`/api/orders?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch orders');
      if (requestId !== latestOrderRequest.current) return;

      const nextOrders: OrderRecord[] = data.orders || [];
      setOrders(nextOrders);
      setTotalOrders(Number(data.total) || 0);
      setShipmentDrafts(Object.fromEntries(nextOrders.map((order) => [
        order.id,
        {
          shipmentStatus: order.shipment_status || 'yet_to_ship',
          trackingId: order.tracking_id || '',
        },
      ])));
      setSavedOrderId(null);
      setAllChangesSaved(false);
    } catch (e) {
      if (requestId === latestOrderRequest.current) {
        console.error('Failed to fetch orders:', e);
      }
    } finally {
      if (requestId === latestOrderRequest.current) setLoading(false);
    }
  }, [filterParams, currentPage]);

  // Production summary for every order matching the filters, not just this page.
  const latestProductionRequest = useRef(0);
  const fetchProduction = useCallback(async () => {
    const requestId = latestProductionRequest.current + 1;
    latestProductionRequest.current = requestId;
    try {
      const res = await fetch(`/api/orders/production?${filterParams}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch production summary');
      if (requestId !== latestProductionRequest.current) return;
      const counts = data.orderCounts ?? {};
      setProduction(([
        { name: 'Pickup Orders', quantity: Number(counts.pickup) || 0, unit: 'orders' },
        { name: 'Delivery Orders', quantity: Number(counts.delivery) || 0, unit: 'orders' },
      ] as ProductionItem[]).filter((item) => item.quantity > 0).sort((a, b) => b.quantity - a.quantity));
    } catch (e) {
      if (requestId === latestProductionRequest.current) console.error('Failed to fetch production summary:', e);
    }
  }, [filterParams]);

  useEffect(() => {
    if (authed) fetchOrders();
  }, [authed, fetchOrders]);

  useEffect(() => {
    if (authed) fetchProduction();
  }, [authed, fetchProduction]);

  const handleLogout = async () => {
    await fetch('/api/auth', { method: 'DELETE' });
    router.push('/admin/login');
  };

  const updateShipmentDraft = (
    orderId: string,
    patch: Partial<{ shipmentStatus: ShipmentStatus; trackingId: string }>
  ) => {
    setShipmentDrafts((current) => ({
      ...current,
      [orderId]: {
        shipmentStatus: current[orderId]?.shipmentStatus || 'yet_to_ship',
        trackingId: current[orderId]?.trackingId || '',
        ...patch,
      },
    }));
    setSavedOrderId(null);
    setAllChangesSaved(false);
  };

  const saveShipment = async (orderId: string) => {
    const draft = shipmentDrafts[orderId];
    if (!draft) return;
    const normalizedDraft = { ...draft, trackingId: draft.trackingId.trim() };

    setSavingOrderId(orderId);
    setSavedOrderId(null);
    try {
      const res = await fetch('/api/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, ...normalizedDraft }),
      });
      if (!res.ok) throw new Error('Shipment update failed');

      setOrders((current) => current.map((order) => order.id === orderId
        ? {
            ...order,
            shipment_status: normalizedDraft.shipmentStatus,
            tracking_id: normalizedDraft.trackingId || null,
          }
        : order));
      setShipmentDrafts((current) => ({ ...current, [orderId]: normalizedDraft }));
      setSavedOrderId(orderId);
    } catch (e) {
      console.error('Failed to update shipment:', e);
      window.alert('Shipment details could not be saved. Please try again.');
    } finally {
      setSavingOrderId(null);
    }
  };

  const saveAllShipments = async () => {
    if (dirtyOrders.length === 0) return;

    const updates = dirtyOrders.map((order) => {
      const draft = shipmentDrafts[order.id];
      return {
        orderId: order.id,
        shipmentStatus: draft.shipmentStatus,
        trackingId: draft.trackingId.trim(),
      };
    });

    setSavingAll(true);
    setAllChangesSaved(false);
    setSavedOrderId(null);
    try {
      const res = await fetch('/api/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Shipment updates failed');

      const updatedIds = new Set<string>(
        Array.isArray(data.updatedOrderIds) ? data.updatedOrderIds : updates.map((item) => item.orderId)
      );
      const updatesById = new Map(updates.map((item) => [item.orderId, item]));

      setOrders((current) => current.map((order) => {
        const update = updatesById.get(order.id);
        if (!update || !updatedIds.has(order.id)) return order;
        return {
          ...order,
          shipment_status: update.shipmentStatus,
          tracking_id: update.trackingId || null,
        };
      }));
      setShipmentDrafts((current) => {
        const next = { ...current };
        for (const update of updates) {
          if (updatedIds.has(update.orderId)) {
            next[update.orderId] = {
              shipmentStatus: update.shipmentStatus,
              trackingId: update.trackingId,
            };
          }
        }
        return next;
      });

      const notUpdated = Array.isArray(data.notUpdatedOrderIds) ? data.notUpdatedOrderIds : [];
      if (notUpdated.length > 0) {
        window.alert(`${notUpdated.length} order(s) could not be updated. Refresh and try again.`);
      } else {
        setAllChangesSaved(true);
      }
    } catch (e) {
      console.error('Failed to save shipment sheet:', e);
      window.alert('Shipment changes could not be saved. Please try again.');
    } finally {
      setSavingAll(false);
    }
  };

  const refreshOrders = () => {
    if (
      dirtyOrders.length > 0 &&
      !window.confirm('Refresh and discard your unsaved shipment changes?')
    ) return;
    fetchOrders();
    fetchProduction();
  };

  const selectQuickFilter = (nextFilter: FilterType) => {
    if (
      dirtyOrders.length > 0 &&
      !window.confirm('Change the view and discard your unsaved shipment changes?')
    ) return;
    clearColumnFilters();
    setFilter(nextFilter);
  };

  const clearColumnFilters = () => {
    setDateFilter('');
    setShipmentFilter('all');
    setPickupLocationFilter('');
  };

  const canChangeView = (): boolean => (
    dirtyOrders.length === 0 ||
    window.confirm('Change the view and discard your unsaved shipment changes?')
  );

  const changeDateFilter = (value: string) => {
    if (!canChangeView()) return;
    setDateFilter(value);
    if (value) {
      setFilter('all');
    }
  };

  const changeShipmentFilter = (value: ShipmentColumnFilter) => {
    if (!canChangeView()) return;
    setShipmentFilter(value);
    if (value !== 'all') {
      // Delivery statuses fit "Delivery orders" but not a pickup location; pickup fits neither delivery.
      if (value === 'pickup' ? pickupLocationFilter === DELIVERY_ORDERS : pickupLocationFilter !== DELIVERY_ORDERS) {
        setPickupLocationFilter('');
      }
      setFilter('all');
    }
  };

  const changePickupLocationFilter = (value: string) => {
    if (!canChangeView()) return;
    setPickupLocationFilter(value);
    if (value) {
      const keepsShipmentFilter = value === DELIVERY_ORDERS ? shipmentFilter !== 'pickup' : shipmentFilter === 'pickup';
      if (shipmentFilter !== 'all' && !keepsShipmentFilter) {
        setShipmentFilter('all');
      }
      setFilter('all');
    }
  };

  const clearColumnFiltersSafely = () => {
    if (!canChangeView()) return;
    clearColumnFilters();
  };

  if (!authed) {
    return (
      <div className="section-padding py-16 text-center">
        <p className="font-body text-brand-charcoal/60">Checking authentication...</p>
      </div>
    );
  }

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
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/admin/production" className="btn-primary text-xs gap-1.5">
            <ChefHat size={14} /> Production Planning
          </Link>
          <Link href="/admin/taxes" className="btn-secondary text-xs gap-1.5">Tax records</Link>
          <Link
            href="/admin/coupons"
            className="btn-secondary text-xs gap-1.5"
          >
            <Ticket size={14} /> Coupons
          </Link>
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

      {/* Sold-out pickup dates */}
      <SoldOutDatesPanel />

      {/* Inventory */}
      <InventoryPanel />

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
        <button
          type="button"
          onClick={() => setFiltersOpen((current) => !current)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-body text-xs font-medium transition-colors ${
            filtersOpen || activeColumnFilterCount > 0
              ? 'bg-brand-gold/15 text-brand-maroon'
              : 'text-brand-charcoal/60 hover:bg-brand-cream'
          }`}
          aria-expanded={filtersOpen || activeColumnFilterCount > 0}
          aria-controls="order-column-filters"
        >
          <Filter size={15} />
          Filters
          {activeColumnFilterCount > 0 && (
            <span className="rounded-full bg-brand-maroon text-white min-w-5 h-5 px-1 inline-flex items-center justify-center text-[10px]">
              {activeColumnFilterCount}
            </span>
          )}
        </button>
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => selectQuickFilter(key)}
            className={`px-3 py-1.5 rounded-full font-body text-xs font-medium transition-colors ${
              filter === key
                ? 'bg-brand-maroon text-white'
                : 'bg-brand-cream text-brand-charcoal/60 hover:bg-brand-cream-dark'
            }`}
          >
            {label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={saveAllShipments}
            disabled={dirtyOrders.length === 0 || savingAll || savingOrderId !== null}
            className="inline-flex items-center gap-1.5 rounded-full bg-brand-maroon px-3 py-1.5 font-body text-xs font-semibold text-white transition-colors hover:bg-brand-maroon-dark disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Save size={14} />
            {savingAll
              ? 'Saving…'
              : allChangesSaved && dirtyOrders.length === 0
                ? 'All saved'
                : dirtyOrders.length > 0
                  ? `Save changes (${dirtyOrders.length})`
                  : 'Save changes'}
          </button>
          <button
            type="button"
            onClick={refreshOrders}
            disabled={loading || savingAll || savingOrderId !== null}
            className="p-1.5 rounded-full hover:bg-brand-cream transition-colors disabled:opacity-40"
            aria-label="Refresh"
          >
            <RefreshCw size={16} className={`text-brand-charcoal/40 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {(filtersOpen || activeColumnFilterCount > 0) && (
        <div
          id="order-column-filters"
          className="card p-4 mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.4fr_auto] gap-3 items-end"
        >
          <label className="block">
            <span className="block font-body text-xs font-semibold text-brand-charcoal/60 mb-1.5">
              Date
            </span>
            <input
              type="date"
              value={dateFilter}
              onChange={(event) => changeDateFilter(event.target.value)}
              className="input-field py-2 text-sm"
            />
            <span className="block font-body text-[10px] text-brand-charcoal/40 mt-1">
              Pickup date or delivery order date
            </span>
          </label>
          <label className="block">
            <span className="block font-body text-xs font-semibold text-brand-charcoal/60 mb-1.5">
              Shipment status
            </span>
            <select
              value={shipmentFilter}
              onChange={(event) => changeShipmentFilter(event.target.value as ShipmentColumnFilter)}
              className="input-field py-2 text-sm"
            >
              <option value="all">All statuses</option>
              <option value="yet_to_ship">Yet to ship</option>
              <option value="shipped">Shipped</option>
              <option value="delivered">Delivered</option>
              <option value="pickup">Pickup orders</option>
            </select>
          </label>
          <label className="block">
            <span className="block font-body text-xs font-semibold text-brand-charcoal/60 mb-1.5">
              Pickup location / delivery
            </span>
            <select
              value={pickupLocationFilter}
              onChange={(event) => changePickupLocationFilter(event.target.value)}
              className="input-field py-2 text-sm"
            >
              <option value="">All orders</option>
              {PICKUP_LOCATIONS.map((location) => (
                <option key={location.id} value={location.id}>{location.name}</option>
              ))}
              <option value={DELIVERY_ORDERS}>Delivery orders</option>
            </select>
          </label>
          <button
            type="button"
            onClick={clearColumnFiltersSafely}
            disabled={activeColumnFilterCount === 0}
            className="btn-secondary py-2 text-xs disabled:opacity-40"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Orders table */}
      {loading ? (
        <div className="text-center py-12">
          <p className="font-body text-brand-charcoal/40">Loading orders...</p>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="text-center py-12">
          <Package size={36} className="mx-auto text-brand-charcoal/20 mb-3" />
          <p className="font-body text-brand-charcoal/40">
            No orders found for these filters.
          </p>
        </div>
      ) : (
        <div ref={tableTop} className="overflow-x-auto scroll-mt-4">
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
                  'Sales tax',
                  'Payment',
                  'Status',
                  'Shipment Status',
                  'Tracking ID',
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
              {pageOrders.map((order) => (
                  <tr
                    key={order.id}
                    className="border-b border-brand-cream-dark/50 hover:bg-brand-cream/50 transition-colors"
                  >
                    <td className="py-3 px-2 font-body text-xs font-medium text-brand-maroon">
                      {order.order_number}
                      {!!order.is_test_order && <span className="block mt-1 text-brand-charcoal/60">Test order · excluded from reports</span>}
                    </td>
                    <td className="py-3 px-2 font-body text-xs">
                      {order.customer_name || '—'}
                      <br />
                      <span className="text-brand-charcoal/40">{order.phone_number || ''}</span>
                    </td>
                    <td className="py-3 px-2 font-body text-xs max-w-[180px] text-brand-charcoal/70">
                      {order.order_items && order.order_items.length > 0 ? (
                        <div className="space-y-0.5">
                          {order.order_items.map((it, idx) => (
                            <div key={idx}>
                              {it.product_name}
                              {it.selected_tier ? (
                                <span className="text-brand-charcoal/40"> ({it.selected_tier} pcs)</span>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-3 px-2 font-body text-xs text-brand-charcoal/60">
                      {order.order_items && order.order_items.length > 0 ? (
                        <div className="space-y-0.5">
                          {order.order_items.map((it, idx) => (
                            <div key={idx}>× {it.quantity}</div>
                          ))}
                        </div>
                      ) : (
                        '—'
                      )}
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
                      {order.order_type === 'delivery' && order.shipping_method && (
                        <span className="block font-body text-[11px] text-brand-charcoal/50 mt-1">
                          {shippingMethodLabel(order.shipping_method)}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-2 font-body text-xs text-brand-charcoal/60">
                      {order.order_type === 'pickup' ? (
                        <>
                          {order.pickup_date || '—'}
                          <br />
                          {order.pickup_location || '—'}
                        </>
                      ) : (
                        <>
                          <span>
                            {d1TimestampToBusinessDate(order.created_at) || '—'}
                          </span>
                          <br />
                          <span className="whitespace-pre-line">
                            {order.delivery_address || '—'}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="py-3 px-2 font-body text-xs font-medium">
                      {formatCurrency(order.total_price)}
                      {(order.maintenance_fee ?? 0) > 0 && <div className="font-normal text-brand-charcoal/60">Includes maintenance fee: {formatCurrency(order.maintenance_fee!)}</div>}
                    </td>
                    <td className="py-3 px-2 font-body text-xs font-medium">
                      {formatCurrency(order.tax ?? 0)}
                    </td>
                    <td className="py-3 px-2">
                      <span
                        className={`font-body text-xs px-2 py-0.5 rounded-full ${
                          order.payment_status === 'paid'
                            ? 'bg-green-50 text-green-700'
                            : order.payment_status === 'refunded'
                              ? 'bg-red-50 text-red-700'
                              : 'bg-amber-50 text-amber-700'
                        }`}
                      >
                        {order.payment_status.replaceAll('_', ' ')}
                      </span>
                    </td>
                    <td className="py-3 px-2 font-body text-xs text-brand-charcoal/50">
                      {order.status}
                    </td>
                    <td className="py-3 px-2 min-w-[145px]">
                      {order.order_type === 'delivery' ? (
                        <select
                          value={shipmentDrafts[order.id]?.shipmentStatus || 'yet_to_ship'}
                          disabled={savingAll || savingOrderId === order.id}
                          onChange={(e) => updateShipmentDraft(order.id, {
                            shipmentStatus: e.target.value as ShipmentStatus,
                          })}
                          className="input-field py-1.5 text-xs"
                          aria-label={`Shipment status for ${order.order_number}`}
                        >
                          <option value="yet_to_ship">Yet to ship</option>
                          <option value="shipped">Shipped</option>
                          <option value="delivered">Delivered</option>
                        </select>
                      ) : (
                        <span className="font-body text-xs text-brand-charcoal/40">Pickup</span>
                      )}
                    </td>
                    <td className="py-3 px-2 min-w-[190px]">
                      {order.order_type === 'delivery' ? (
                        <div className="space-y-1.5">
                          <input
                            type="text"
                            value={shipmentDrafts[order.id]?.trackingId || ''}
                            disabled={savingAll || savingOrderId === order.id}
                            onChange={(e) => updateShipmentDraft(order.id, { trackingId: e.target.value })}
                            placeholder="Tracking number"
                            className="input-field py-1.5 text-xs"
                            maxLength={120}
                            aria-label={`Tracking number for ${order.order_number}`}
                          />
                          <button
                            type="button"
                            onClick={() => saveShipment(order.id)}
                            disabled={savingAll || savingOrderId === order.id}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-maroon disabled:opacity-50"
                          >
                            <Save size={12} />
                            {savingOrderId === order.id
                              ? 'Saving…'
                              : savedOrderId === order.id
                                ? 'Saved'
                                : 'Save'}
                          </button>
                        </div>
                      ) : (
                        <span className="font-body text-xs text-brand-charcoal/40">—</span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          <nav aria-label="Orders pages" className="flex flex-wrap items-center justify-between gap-3 py-4">
            <p className="font-body text-xs text-brand-charcoal/60">
              Showing {pageStart + 1}–{pageStart + pageOrders.length} of {totalOrders} orders
            </p>
            {pageCount > 1 && (
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="px-3 py-1.5 rounded-lg font-body text-xs border border-brand-cream-dark hover:bg-brand-cream disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                {pageNumbers(currentPage, pageCount).map((page, i) => page === 'gap' ? (
                  <span key={`gap-${i}`} className="px-1 font-body text-xs text-brand-charcoal/40" aria-hidden="true">…</span>
                ) : (
                  <button
                    key={page}
                    type="button"
                    onClick={() => goToPage(page)}
                    aria-label={`Page ${page}`}
                    aria-current={page === currentPage ? 'page' : undefined}
                    className={`min-w-8 px-2.5 py-1.5 rounded-lg font-body text-xs border ${
                      page === currentPage
                        ? 'bg-brand-maroon text-white border-brand-maroon font-semibold'
                        : 'border-brand-cream-dark hover:bg-brand-cream'
                    }`}
                  >
                    {page}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage === pageCount}
                  className="px-3 py-1.5 rounded-lg font-body text-xs border border-brand-cream-dark hover:bg-brand-cream disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            )}
          </nav>
        </div>
      )}
    </div>
  );
}
