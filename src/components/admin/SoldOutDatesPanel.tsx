'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { CalendarX2, Loader2 } from 'lucide-react';
import { toBusinessDateString } from '@/lib/date';
import { MAX_PICKUP_DAYS_AHEAD } from '@/lib/pickup-date';

function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Admin: mark pickup dates sold out (today or later) and reopen them. Checkout
 * greys those days out with "Sold out" and the server refuses pickup on them.
 */
export default function SoldOutDatesPanel() {
  const today = toBusinessDateString(new Date());
  const inputId = useId();
  const [dates, setDates] = useState<string[]>([]);
  const [chosen, setChosen] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/sold-out-dates', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error();
      setDates(Array.isArray(data.dates) ? data.dates : []);
    } catch {
      setError('Could not load sold-out dates.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const change = async (date: string, soldOut: boolean) => {
    setBusy(date);
    setError('');
    try {
      const res = await fetch('/api/sold-out-dates', {
        method: soldOut ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDates(Array.isArray(data.dates) ? data.dates : []);
      if (soldOut) setChosen('');
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Could not update the date.');
    } finally {
      setBusy(null);
    }
  };

  const todaySoldOut = dates.includes(today);

  return (
    <div className="card p-6 mb-8">
      <div className="flex items-center gap-2 mb-1">
        <CalendarX2 size={20} className="text-brand-gold" />
        <h2 className="font-display text-lg font-semibold text-brand-charcoal">Sold-out pickup dates</h2>
      </div>
      <p className="font-body text-xs text-brand-charcoal/60 mb-4">
        Customers can&apos;t choose these dates for pickup; the checkout calendar shows &ldquo;Sold out&rdquo; on them.
        Delivery orders are not affected.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <button
          type="button"
          onClick={() => change(today, true)}
          disabled={todaySoldOut || busy !== null}
          className="btn-primary text-xs py-2 px-4 gap-1.5 disabled:opacity-50"
        >
          {busy === today ? <Loader2 size={13} className="animate-spin" /> : null}
          {todaySoldOut ? 'Today is sold out' : 'Mark today sold out'}
        </button>
        <div>
          <label htmlFor={inputId} className="block font-body text-xs text-brand-charcoal/70 mb-1">Another date</label>
          <input
            id={inputId}
            type="date"
            min={today}
            max={addDays(today, MAX_PICKUP_DAYS_AHEAD)}
            value={chosen}
            onChange={(e) => setChosen(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg font-body text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
          />
        </div>
        <button
          type="button"
          onClick={() => chosen && change(chosen, true)}
          disabled={!chosen || dates.includes(chosen) || busy !== null}
          className="btn-secondary text-xs py-2 px-4 disabled:opacity-50"
        >
          Mark sold out
        </button>
      </div>

      {error && <p role="alert" className="font-body text-sm text-red-600 mt-3">{error}</p>}

      {dates.length > 0 ? (
        <ul aria-label="Sold-out dates" className="mt-4 divide-y divide-brand-cream-dark border border-brand-cream-dark rounded-lg">
          {dates.map((date) => (
            <li key={date} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="font-body text-sm text-brand-charcoal">
                {dayLabel(date)}{date === today && <strong className="ml-1 text-red-600">(today)</strong>}
                <span className="ml-2 font-body text-[11px] font-bold uppercase text-red-600">Sold out</span>
              </span>
              <button
                type="button"
                onClick={() => change(date, false)}
                disabled={busy !== null}
                className="font-body text-xs font-semibold text-brand-maroon underline underline-offset-2 disabled:opacity-50"
              >
                Reopen
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="font-body text-sm text-brand-charcoal/50 mt-4">No dates are sold out.</p>
      )}
    </div>
  );
}
