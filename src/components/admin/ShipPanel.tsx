'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Star, Truck, X, Download, Ban } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { toBusinessDateString } from '@/lib/date';
import type { LabelRow, RateOption, ShippingOrder } from '@/lib/shipping-labels';

interface Context {
  order: ShippingOrder;
  boxes: Array<{ id: string; label: string }>;
  priceLimit: number;
  defaultShipDate: string;
  shippoConfigured: boolean;
}

interface Quote {
  shipmentId: string;
  shipDate: string;
  rates: RateOption[];
  addressCheck: { valid: boolean | null; messages: string[] };
  messages: string[];
}

function dayLabel(date: string | null): string {
  return date ? new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }) : '—';
}

async function post(body: Record<string, unknown>) {
  const res = await fetch('/api/admin/shipping', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { code: data.code });
  return data;
}

/** Admin side panel for one delivery order: route, box + weight, UPS rates, buy, download, void. */
export default function ShipPanel({ orderId, onClose, onChanged }: { orderId: string; onClose: () => void; onChanged: () => void }) {
  const [ctx, setCtx] = useState<Context | null>(null);
  const [box, setBox] = useState('9x9x6');
  const [other, setOther] = useState({ l: '', w: '', h: '' });
  const [weight, setWeight] = useState('');
  const [shipDate, setShipDate] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [confirmRate, setConfirmRate] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch(`/api/admin/shipping?orderId=${encodeURIComponent(orderId)}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load the order.');
      setCtx(data);
      const saved: string | null = data.order.box;
      if (saved && !data.boxes.some((b: { id: string }) => b.id === saved)) {
        const [l, w, h] = saved.split('x');
        setBox('other');
        setOther({ l: l ?? '', w: w ?? '', h: h ?? '' });
      } else if (saved) {
        setBox(saved);
      }
      if (data.order.weightLb) setWeight(String(data.order.weightLb));
      setShipDate((current) => current || data.defaultShipDate);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the order.');
    }
  }, [orderId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async (name: string, action: () => Promise<void>) => {
    setBusy(name);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  const boxValue = box === 'other' ? `${other.l}x${other.w}x${other.h}` : box;
  const getRates = () => run('quote', async () => {
    setQuote(null);
    setConfirmRate(null);
    setQuote(await post({ action: 'quote', orderId, box: boxValue, weightLb: Number(weight), shipDate }));
  });
  const buy = (rate: RateOption) => run(`buy-${rate.rateId}`, async () => {
    const confirmOverLimit = rate.overLimit && confirmRate === rate.rateId;
    if (rate.overLimit && !confirmOverLimit) {
      setConfirmRate(rate.rateId);
      return;
    }
    await post({ action: 'buy', orderId, rateId: rate.rateId, shipDate: quote?.shipDate ?? shipDate, confirmOverLimit });
    setQuote(null);
    await load();
    onChanged();
  });
  const act = (name: 'void' | 'release', question: string) => run(name, async () => {
    if (!window.confirm(question)) return;
    await post({ action: name, orderId });
    await load();
    onChanged();
  });
  const setRoute = (route: 'shippo' | 'pirate_ship' | null) => run('route', async () => {
    await post({ action: 'route', orderId, route });
    setQuote(null);
    await load();
    onChanged();
  });

  const order = ctx?.order;
  const label: LabelRow | null = order?.activeLabel ?? null;
  const pastLabels = order?.labels.filter((l) => l.status === 'voided' || l.status === 'failed') ?? [];

  return (
    <div className="fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal="true" aria-label={`Ship ${order?.orderNumber ?? 'order'}`}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/30" />
      <div className="relative h-full w-full sm:max-w-md bg-white shadow-xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-brand-cream-dark px-5 py-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold text-brand-charcoal flex items-center gap-2">
            <Truck size={20} className="text-brand-gold" /> Ship {order?.orderNumber ?? ''}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded hover:bg-brand-cream"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-5 font-body text-sm">
          {!ctx && !error && <p className="text-brand-charcoal/50 flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading…</p>}
          {error && <p role="alert" className="text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>}

          {order && (
            <>
              {!ctx.shippoConfigured && (
                <p className="text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">Shippo is not connected here (no API key).</p>
              )}
              <section>
                <p className="font-semibold text-brand-charcoal">{order.customerName}</p>
                <p className="text-brand-charcoal/70 whitespace-pre-line">{order.addressText ?? 'No address'}</p>
                <p className="text-brand-charcoal/60 mt-1">
                  Customer paid {order.shippingPaid == null ? '—' : formatCurrency(order.shippingPaid)} shipping · ordered {order.createdAt.slice(0, 10)}
                </p>
              </section>

              <section aria-label="Packing list">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-brand-charcoal/60 mb-1">Packing list</h3>
                <ul className="list-disc pl-5 text-brand-charcoal/80">
                  {order.items.map((i, k) => <li key={k}>{i.product_name}{i.selected_tier ? ` (${i.selected_tier} pcs)` : ''} × {i.quantity}</li>)}
                </ul>
              </section>

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-brand-charcoal/60 mb-1">Ships by</h3>
                <div className="flex gap-2" role="group" aria-label="Ships by">
                  {(['shippo', 'pirate_ship'] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRoute(r === order.autoRoute ? null : r)}
                      disabled={Boolean(label) || busy !== null || order.route === r}
                      aria-pressed={order.route === r}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-semibold ${order.route === r ? 'bg-brand-maroon text-white border-brand-maroon' : 'border-brand-cream-dark text-brand-charcoal hover:bg-brand-cream'} disabled:cursor-not-allowed`}
                    >
                      {r === 'shippo' ? 'Shippo (UPS)' : 'Pirate Ship (by hand)'}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-brand-charcoal/60 mt-1">
                  Rule: {order.autoRoute === 'shippo' ? 'Shippo' : 'Pirate Ship'} — {order.routeReason}.
                  {order.routeOverride && ' You changed it for this order.'}
                </p>
              </section>

              {order.route === 'pirate_ship' && !label && (
                <p className="bg-brand-cream rounded-lg p-3 text-brand-charcoal">
                  Ship this order on Pirate Ship, then type its tracking number in the Tracking column and Save.
                  The customer gets the tracking email at 6:30 PM.
                </p>
              )}

              {label && (
                <section className="border border-brand-gold/40 bg-brand-gold/5 rounded-xl p-4 space-y-2" aria-label="Label">
                  {label.status === 'purchased' ? (
                    <>
                      <p className="font-semibold text-brand-charcoal">{label.service_name} · {formatCurrency(label.amount ?? 0)}</p>
                      <p>Tracking: <span className="font-mono">{label.tracking_number ?? '—'}</span></p>
                      <p className="text-brand-charcoal/70">Ship date {dayLabel(label.ship_date)} · {label.box} in · {label.weight_lb} lb</p>
                      {label.scanned_at && <p className="text-green-700">UPS scanned it {label.scanned_at.slice(0, 10)}.</p>}
                      <div className="flex flex-wrap gap-2 pt-1">
                        {label.label_url && (
                          <a href={label.label_url} target="_blank" rel="noopener noreferrer" className="btn-primary text-xs py-2 px-3 gap-1.5">
                            <Download size={14} /> Download label (PDF)
                          </a>
                        )}
                        {!label.scanned_at && (
                          <button type="button" onClick={() => act('void', `Void the ${label.service_name} label for ${order.orderNumber}? Shippo refunds its cost.`)} disabled={busy !== null} className="btn-secondary text-xs py-2 px-3 gap-1.5">
                            {busy === 'void' ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />} Void label
                          </button>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="font-semibold text-amber-800">Purchase not confirmed</p>
                      <p className="text-brand-charcoal/70">{label.error ?? 'Shippo did not answer.'}</p>
                      <p className="text-brand-charcoal/70">Check the Shippo dashboard. If no label was bought there, release this order to try again.</p>
                      <button type="button" onClick={() => act('release', 'Release this order? Only do this if Shippo shows no label for it.')} disabled={busy !== null} className="btn-secondary text-xs py-2 px-3">
                        Release
                      </button>
                    </>
                  )}
                </section>
              )}

              {order.route === 'shippo' && !label && order.shipmentStatus === 'yet_to_ship' && (
                <section className="space-y-3" aria-label="Label details">
                  <div>
                    <label htmlFor="ship-box" className="block text-xs font-semibold text-brand-charcoal/70 mb-1">Box</label>
                    <select id="ship-box" value={box} onChange={(e) => setBox(e.target.value)} className="input-field py-2">
                      {ctx.boxes.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
                      <option value="other">Other size…</option>
                    </select>
                    {box === 'other' && (
                      <div className="grid grid-cols-3 gap-2 mt-2">
                        {(['l', 'w', 'h'] as const).map((k) => (
                          <input key={k} inputMode="decimal" value={other[k]} onChange={(e) => setOther((o) => ({ ...o, [k]: e.target.value }))}
                            placeholder={k === 'l' ? 'Length in' : k === 'w' ? 'Width in' : 'Height in'} aria-label={k === 'l' ? 'Length' : k === 'w' ? 'Width' : 'Height'} className="input-field py-2" />
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="ship-weight" className="block text-xs font-semibold text-brand-charcoal/70 mb-1">Packed weight (lb, box included)</label>
                      <input id="ship-weight" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="e.g. 2.4" className="input-field py-2" />
                    </div>
                    <div>
                      <label htmlFor="ship-date" className="block text-xs font-semibold text-brand-charcoal/70 mb-1">Ship date</label>
                      <input id="ship-date" type="date" value={shipDate} min={toBusinessDateString(new Date())} onChange={(e) => setShipDate(e.target.value)} className="input-field py-2" />
                    </div>
                  </div>
                  <button type="button" onClick={getRates} disabled={busy !== null || !weight || !shipDate} className="btn-primary w-full gap-2">
                    {busy === 'quote' ? <Loader2 size={16} className="animate-spin" /> : <Truck size={16} />} Get label ETA
                  </button>
                </section>
              )}

              {quote && !label && (
                <section className="space-y-3" aria-label="UPS rates">
                  {quote.addressCheck.valid !== true && (
                    <p role="alert" className="text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                      {quote.addressCheck.valid === false
                        ? 'Stop: UPS/USPS could not confirm this address.'
                        : 'Stop: the address check gave no clear answer.'} {quote.addressCheck.messages.join(' ')} No label can be bought until the address is confirmed. {quote.addressCheck.valid === false
                        ? 'Check it with the customer.'
                        : 'Try Get label ETA again in a minute.'}
                    </p>
                  )}
                  {quote.rates.length === 0 && <p className="text-red-700">No UPS Ground or 2nd Day Air rates came back. {quote.messages.join(' ')}</p>}
                  {quote.rates.map((rate) => (
                    <div key={rate.rateId} className={`rounded-xl border p-4 ${rate.recommended ? 'border-brand-gold bg-brand-gold/5' : 'border-brand-cream-dark'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-brand-charcoal flex items-center gap-1">
                            {rate.recommended && <Star size={14} className="text-brand-gold fill-brand-gold" aria-label="Recommended" />}
                            {rate.serviceName}
                          </p>
                          <p className="text-brand-charcoal/70">
                            Arrives {dayLabel(rate.arrivesOn)}{rate.estimatedDays != null ? ` · ${rate.estimatedDays} business day${rate.estimatedDays === 1 ? '' : 's'}` : ''}
                          </p>
                          {rate.margin != null && (
                            <p className={rate.margin >= 0 ? 'text-green-700' : 'text-red-700'}>
                              vs {formatCurrency(order.shippingPaid ?? 0)} paid: {rate.margin >= 0 ? '+' : '−'}{formatCurrency(Math.abs(rate.margin))}
                            </p>
                          )}
                        </div>
                        <p className="font-display text-xl font-bold text-brand-maroon">{formatCurrency(rate.amount)}</p>
                      </div>
                      {rate.overLimit && confirmRate === rate.rateId && (
                        <p className="text-amber-800 text-xs mt-2">This label is over {formatCurrency(ctx.priceLimit)}. Tap Buy again to confirm.</p>
                      )}
                      <button type="button" onClick={() => buy(rate)} disabled={busy !== null || quote.addressCheck.valid !== true} className="btn-gold w-full mt-3 gap-2">
                        {busy === `buy-${rate.rateId}` && <Loader2 size={16} className="animate-spin" />}
                        {rate.overLimit && confirmRate === rate.rateId ? `Confirm: buy for ${formatCurrency(rate.amount)}` : `Buy ${rate.serviceName} label`}
                      </button>
                    </div>
                  ))}
                </section>
              )}

              {pastLabels.length > 0 && (
                <section aria-label="Earlier labels">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-brand-charcoal/60 mb-1">Earlier labels</h3>
                  <ul className="space-y-1 text-xs text-brand-charcoal/60">
                    {pastLabels.map((l) => (
                      <li key={l.id}>{l.status === 'voided' ? 'Voided' : 'Failed'} · {l.service_name ?? '—'} · {l.amount != null ? formatCurrency(l.amount) : '—'}{l.error ? ` · ${l.error}` : ''}</li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
