'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Truck } from 'lucide-react';
import { NEARBY_STATE_CODES, type ShippingZone } from '@/lib/pricing';
import { DELIVERY_ZONES } from '@/lib/delivery-pauses';
import type { DeliveryWeeksStatus } from '@/lib/delivery-limit';

const ZONE_LABELS: Record<ShippingZone, { title: string; detail: string }> = {
  texas: { title: 'Texas', detail: 'Deliveries within Texas' },
  nearby: { title: 'Nearby states', detail: NEARBY_STATE_CODES.join(', ') },
  far: { title: 'Far-away states', detail: 'All other states and DC' },
};

/**
 * Weekly limit on delivery orders per shipment week (Mon/Tue dispatch). Shoppers
 * pick a week at checkout; a week shows "Full" once it reaches the limit.
 */
function WeeklyLimit() {
  const [status, setStatus] = useState<DeliveryWeeksStatus | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const show = (next: DeliveryWeeksStatus) => {
    setStatus(next);
    setDraft(next.limit == null ? '' : String(next.limit));
  };

  useEffect(() => {
    fetch('/api/admin/delivery-limit', { cache: 'no-store' })
      .then(async (res) => { if (!res.ok) throw new Error(); show(await res.json()); })
      .catch(() => setMessage({ text: 'Could not load the weekly delivery limit.', error: true }));
  }, []);

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/delivery-limit', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: draft.trim() === '' ? null : Number(draft) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      show(data);
      setMessage({ text: 'Saved', error: false });
    } catch (e) {
      setMessage({ text: e instanceof Error && e.message ? e.message : 'Could not save the limit.', error: true });
    } finally {
      setBusy(false);
    }
  };

  const changed = status !== null && draft.trim() !== (status.limit == null ? '' : String(status.limit));
  return (
    <div className="rounded-lg border border-brand-cream-dark p-4 mt-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="weekly-delivery-limit" className="block font-body text-sm font-semibold text-brand-charcoal">
            Delivery orders per shipment week
          </label>
          <p className="font-body text-[11px] text-brand-charcoal/60">Shoppers pick a week at checkout. Empty = no limit.</p>
        </div>
        <input
          id="weekly-delivery-limit"
          type="number"
          inputMode="numeric"
          min={1}
          max={1000}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setMessage(null); }}
          placeholder="No limit"
          disabled={!status || busy}
          className="input-field w-28 py-1.5"
        />
        <button type="button" onClick={save} disabled={!status || busy || !changed} className="btn-primary text-xs py-2 px-4 disabled:opacity-50">
          {busy ? 'Saving…' : 'Save'}
        </button>
        {message && <span role={message.error ? 'alert' : 'status'} className={`font-body text-xs ${message.error ? 'text-red-600' : 'text-green-700'}`}>{message.text}</span>}
      </div>
      {status && (
        <ul className="mt-3 space-y-1 font-body text-sm" aria-label="Shipment weeks">
          {status.weeks.map((w, i) => (
            <li key={w.week} className={`flex flex-wrap gap-x-2 ${w.full ? 'text-red-700' : 'text-brand-charcoal/80'}`}>
              <span className="font-semibold min-w-[11rem]">Ships {w.days}{i === 0 ? ' (this week)' : ''}</span>
              <span>
                <strong>{w.used}{status.limit != null ? ` of ${status.limit}` : ''}</strong> orders
                {w.full ? ' · FULL' : status.limit != null ? ` · ${status.limit - w.used} left` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      {status?.allFull && (
        <p role="status" className="font-body text-sm text-red-700 font-semibold mt-2">Every bookable week is full, so Delivery is greyed out at checkout.</p>
      )}
    </div>
  );
}

/**
 * Admin → Production: pause delivery to any mix of Texas, nearby states and
 * far-away states, or all delivery at once. Checkout hides delivery to paused
 * areas and the server refuses it. Pickup is never affected.
 */
export default function DeliveryPausePanel() {
  const [paused, setPaused] = useState<ShippingZone[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/delivery-pauses', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !Array.isArray(data.paused)) throw new Error();
      setPaused(data.paused);
      setLoaded(true);
    } catch {
      setError('Could not load delivery settings.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (next: ShippingZone[]) => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/delivery-pauses', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPaused(Array.isArray(data.paused) ? data.paused : next);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Could not update delivery settings.');
    } finally {
      setBusy(false);
    }
  };

  const allPaused = DELIVERY_ZONES.every((zone) => paused.includes(zone));
  const toggle = (zone: ShippingZone) =>
    save(paused.includes(zone) ? paused.filter((z) => z !== zone) : [...paused, zone]);

  return (
    <section aria-labelledby="delivery-pause-title" className="card p-5 mb-6">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <div className="flex items-center gap-2">
          <Truck size={20} className="text-brand-gold" />
          <h2 id="delivery-pause-title" className="font-display text-lg font-semibold text-brand-charcoal">Delivery orders</h2>
          {busy && <Loader2 size={14} className="animate-spin text-brand-charcoal/50" aria-label="Saving" />}
        </div>
        <button
          type="button"
          onClick={() => save(allPaused ? [] : [...DELIVERY_ZONES])}
          disabled={!loaded || busy}
          className={`${allPaused ? 'btn-primary' : 'btn-secondary'} text-xs py-2 px-4 disabled:opacity-50`}
        >
          {allPaused ? 'Resume all delivery' : 'Pause all delivery'}
        </button>
      </div>
      <p className="font-body text-xs text-brand-charcoal/60 mb-4">
        Paused areas can&apos;t choose delivery at checkout. Pickup is not affected. Changes apply right away.
      </p>

      <ul className="grid sm:grid-cols-3 gap-3">
        {DELIVERY_ZONES.map((zone) => {
          const isPaused = paused.includes(zone);
          return (
            <li key={zone}>
              <label className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer ${isPaused ? 'border-red-300 bg-red-50' : 'border-brand-cream-dark'}`}>
                <input
                  type="checkbox"
                  checked={isPaused}
                  onChange={() => toggle(zone)}
                  disabled={!loaded || busy}
                  className="mt-1 h-4 w-4 accent-brand-maroon"
                />
                <span>
                  <span className="block font-body text-sm font-semibold text-brand-charcoal">
                    Pause {ZONE_LABELS[zone].title}
                  </span>
                  <span className="block font-body text-[11px] text-brand-charcoal/60">{ZONE_LABELS[zone].detail}</span>
                  <span className={`block font-body text-[11px] font-bold uppercase mt-1 ${isPaused ? 'text-red-600' : 'text-green-700'}`}>
                    {isPaused ? 'Paused' : 'Open'}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {error && <p role="alert" className="font-body text-sm text-red-600 mt-3">{error}</p>}
      <WeeklyLimit />
    </section>
  );
}
