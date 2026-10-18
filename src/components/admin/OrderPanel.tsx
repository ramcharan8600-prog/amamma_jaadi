'use client';

import { useEffect, type ReactNode } from 'react';
import { Package, Phone, Mail, Save, X } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { d1TimestampToBusinessDate } from '@/lib/date';
import { orderShippingLabel } from '@/lib/order-shipping-label';
import { PICKUP_LOCATIONS } from '@/data/products';
import { adminShipWeekChoices, shipWeekDays } from '@/lib/delivery-limit';
import AdminNoteCell from '@/components/admin/AdminNoteCell';
import type { OrderRecord, ShipmentStatus } from '@/types';

type SaveState = 'saving' | 'saved' | 'error';

function Heading({ children }: { children: ReactNode }) {
  return <h3 className="text-xs font-semibold uppercase tracking-wide text-brand-charcoal/60 mb-1">{children}</h3>;
}

/**
 * Admin → All Orders: everything about one order in a side panel (full screen on a phone) —
 * items, customer, address or pickup, ship week, shipment and tracking, Ship label, refund, note.
 * Saves go through the same handlers as the table, so both always show the same values.
 */
export default function OrderPanel({
  order, draft, savingShipment, shipmentSaved, shipWeekState, trackingNote,
  onDraft, onSaveShipment, onShipWeek, onNoteSaved, onOpenShip, onClose,
}: {
  order: OrderRecord;
  draft: { shipmentStatus: ShipmentStatus; trackingId: string } | undefined;
  savingShipment: boolean;
  shipmentSaved: boolean;
  shipWeekState: SaveState | undefined;
  trackingNote: string | null;
  onDraft: (patch: Partial<{ shipmentStatus: ShipmentStatus; trackingId: string }>) => void;
  onSaveShipment: () => void;
  onShipWeek: (shipWeek: string) => void;
  onNoteSaved: (note: string | null) => void;
  onOpenShip: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const items = order.order_items ?? [];
  const isDelivery = order.order_type === 'delivery';
  const location = PICKUP_LOCATIONS.find((l) => l.id === order.pickup_location);
  const refunded = Number(order.refunded_amount) || 0;
  const weeks = [...new Set([...(order.ship_week ? [order.ship_week] : []), ...adminShipWeekChoices()])].sort();

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`Order ${order.order_number}`}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/30" />
      <div className="relative h-full w-full sm:max-w-md bg-white shadow-xl overflow-y-auto">
        <div className="sticky top-0 z-10 bg-white border-b border-brand-cream-dark px-5 py-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-semibold text-brand-charcoal flex items-center gap-2">
              <Package size={20} className="text-brand-gold" /> {order.order_number}
            </h2>
            <p className="font-body text-xs text-brand-charcoal/60 mt-0.5">
              {isDelivery ? 'Delivery' : 'Pickup'} · ordered {d1TimestampToBusinessDate(order.created_at) || '—'}
              {!!order.is_test_order && ' · Test order'}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded hover:bg-brand-cream"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-5 font-body text-sm">
          <section aria-label="Customer">
            <p className="font-semibold text-brand-charcoal">{order.customer_name || '—'}</p>
            {order.phone_number && (
              <a href={`tel:${order.phone_number}`} className="flex items-center gap-1.5 text-brand-maroon mt-1">
                <Phone size={14} /> {order.phone_number}
              </a>
            )}
            {order.email && (
              <a href={`mailto:${order.email}`} className="flex items-center gap-1.5 text-brand-maroon mt-1 break-all">
                <Mail size={14} /> {order.email}
              </a>
            )}
          </section>

          <section aria-label="Items">
            <Heading>Items</Heading>
            {items.length === 0 ? <p className="text-brand-charcoal/50">—</p> : (
              <ul className="divide-y divide-brand-cream-dark border border-brand-cream-dark rounded-lg">
                {items.map((it, k) => (
                  <li key={k} className="flex items-start justify-between gap-3 px-3 py-2">
                    <span className="text-brand-charcoal">
                      {it.product_name}{it.selected_tier ? <span className="text-brand-charcoal/50"> ({it.selected_tier} pcs)</span> : null}
                    </span>
                    <span className="font-semibold text-brand-maroon whitespace-nowrap">× {it.quantity}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Payment" className="space-y-1">
            <Heading>Payment</Heading>
            <p className="flex justify-between"><span>Total</span><span className="font-semibold">{formatCurrency(order.total_price)}</span></p>
            <p className="flex justify-between text-brand-charcoal/70"><span>Sales tax</span><span>{formatCurrency(order.tax ?? 0)}</span></p>
            {(order.maintenance_fee ?? 0) > 0 && (
              <p className="flex justify-between text-brand-charcoal/70"><span>Maintenance fee</span><span>{formatCurrency(order.maintenance_fee!)}</span></p>
            )}
            <p className="flex justify-between text-brand-charcoal/70">
              <span>Status</span>
              <span className={order.payment_status === 'paid' ? 'text-green-700' : order.payment_status.includes('refunded') ? 'text-red-700' : 'text-amber-700'}>
                {order.payment_status.replaceAll('_', ' ')} · {order.status}
              </span>
            </p>
            {refunded > 0 && (
              <p className="flex justify-between text-red-700"><span>Refunded</span><span>{formatCurrency(refunded)}</span></p>
            )}
            <p className="text-xs text-brand-charcoal/60 pt-1">
              Refunds are made in Square. This order updates by itself once Square sends the refund.
            </p>
          </section>

          {isDelivery ? (
            <>
              <section aria-label="Delivery address">
                <Heading>Ship to</Heading>
                <p className="text-brand-charcoal/80 whitespace-pre-line">{order.delivery_address || 'No address'}</p>
                <p className="text-brand-charcoal/60 mt-1">{orderShippingLabel(order)}</p>
              </section>

              <section>
                <Heading>Ship week</Heading>
                <select
                  id="panel-ship-week"
                  aria-label="Ship week"
                  value={order.ship_week ?? ''}
                  onChange={(e) => onShipWeek(e.target.value)}
                  disabled={shipWeekState === 'saving'}
                  className="input-field py-2"
                >
                  <option value="">Not set</option>
                  {weeks.map((week) => <option key={week} value={week}>{shipWeekDays(week)}</option>)}
                </select>
                {shipWeekState && (
                  <p className={`mt-1 text-xs ${shipWeekState === 'error' ? 'text-red-600' : 'text-brand-charcoal/60'}`}>
                    {shipWeekState === 'saving' ? 'Saving…' : shipWeekState === 'saved' ? 'Saved' : 'Not saved'}
                  </p>
                )}
              </section>

              <section aria-label="Shipment" className="space-y-2">
                <Heading>Shipment</Heading>
                <div className="grid grid-cols-1 gap-2">
                  <select
                    value={draft?.shipmentStatus ?? order.shipment_status ?? 'yet_to_ship'}
                    onChange={(e) => onDraft({ shipmentStatus: e.target.value as ShipmentStatus })}
                    disabled={savingShipment}
                    className="input-field py-2"
                    aria-label="Shipment status"
                  >
                    <option value="yet_to_ship">Yet to ship</option>
                    <option value="shipped">Shipped</option>
                    <option value="delivered">Delivered</option>
                  </select>
                  <input
                    type="text"
                    value={draft?.trackingId ?? order.tracking_id ?? ''}
                    onChange={(e) => onDraft({ trackingId: e.target.value })}
                    disabled={savingShipment}
                    placeholder="Tracking number"
                    maxLength={120}
                    className="input-field py-2"
                    aria-label="Tracking number"
                  />
                </div>
                <button type="button" onClick={onSaveShipment} disabled={savingShipment} className="btn-primary w-full gap-2 py-2">
                  <Save size={16} /> {savingShipment ? 'Saving…' : shipmentSaved ? 'Saved' : 'Save shipment'}
                </button>
                {trackingNote && <p className="text-xs text-brand-charcoal/60">{trackingNote}</p>}
              </section>

              <section aria-label="Label">
                <Heading>Label</Heading>
                {order.label_status === 'purchased' ? (
                  <p className="text-green-700">Label bought · {order.label_service ?? ''}{order.label_amount != null ? ` ${formatCurrency(order.label_amount)}` : ''}</p>
                ) : order.label_status === 'buying' ? (
                  <p className="text-amber-700">Label not confirmed — open Ship to check.</p>
                ) : (
                  <p className="text-brand-charcoal/60">No label yet.</p>
                )}
                <button type="button" onClick={onOpenShip} className="btn-secondary w-full mt-2 py-2">🚚 Open Ship panel</button>
              </section>
            </>
          ) : (
            <section aria-label="Pickup">
              <Heading>Pickup</Heading>
              <p className="text-brand-charcoal">{order.pickup_date || '—'}</p>
              <p className="text-brand-charcoal/70">{location?.name ?? order.pickup_location ?? '—'}</p>
            </section>
          )}

          <section aria-label="Note">
            <Heading>Private note</Heading>
            <AdminNoteCell orderId={order.id} orderNumber={order.order_number} note={order.admin_note} onSaved={onNoteSaved} />
          </section>
        </div>
      </div>
    </div>
  );
}
