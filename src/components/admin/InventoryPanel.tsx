'use client';

import { useState, useEffect, useCallback } from 'react';
import { Boxes, Check, Loader2 } from 'lucide-react';
import { PRODUCTS, TRACKED_CATEGORY } from '@/data/products';

/**
 * Admin stock editor for tracked products (pickles).
 * Counts decrement automatically on each paid order; this panel is for
 * restocking and corrections.
 */
export default function InventoryPanel() {
  const [stock, setStock] = useState<Record<string, number>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/inventory');
      const data = await res.json();
      const map = (data.stock ?? {}) as Record<string, number>;
      setStock(map);
      setDrafts(Object.fromEntries(Object.entries(map).map(([k, v]) => [k, String(v)])));
    } catch {
      setError('Could not load stock counts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (productId: string) => {
    const raw = drafts[productId];
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      setError('Enter a valid number (0 or more).');
      return;
    }
    setSavingId(productId);
    setError('');
    try {
      const res = await fetch('/api/inventory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, stockCount: Math.floor(value) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not update stock.');
        return;
      }
      setStock(data.stock ?? {});
      setSavedId(productId);
      setTimeout(() => setSavedId(null), 1500);
    } catch {
      setError('Could not update stock.');
    } finally {
      setSavingId(null);
    }
  };

  const tracked = PRODUCTS.filter((p) => p.category === TRACKED_CATEGORY);

  return (
    <div className="card p-6 mb-8">
      <div className="flex items-center gap-2 mb-4">
        <Boxes size={20} className="text-brand-gold" />
        <h2 className="font-display text-lg font-semibold text-brand-charcoal">
          Inventory — Pickles
        </h2>
        <span className="font-body text-xs text-brand-charcoal/40 ml-1">
          counts drop automatically with each paid order
        </span>
      </div>

      {error && <p className="font-body text-sm text-red-600 mb-3">{error}</p>}

      {loading ? (
        <p className="font-body text-sm text-brand-charcoal/40">Loading stock…</p>
      ) : (
        <div className="space-y-2">
          {tracked.map((p) => {
            const current = stock[p.id] ?? 0;
            const isOut = current <= 0;
            const isLow = current > 0 && current <= 5;
            return (
              <div
                key={p.id}
                className="flex items-center gap-3 flex-wrap bg-brand-cream rounded-lg px-3 py-2.5"
              >
                <span className="font-body text-sm font-medium text-brand-charcoal flex-1 min-w-[140px]">
                  {p.name}
                </span>
                <span
                  className={`font-body text-xs px-2 py-0.5 rounded-full ${
                    isOut
                      ? 'bg-red-50 text-red-700'
                      : isLow
                        ? 'bg-amber-50 text-amber-700'
                        : 'bg-green-50 text-green-700'
                  }`}
                >
                  {isOut ? 'Out of stock' : `${current} in stock`}
                </span>
                <input
                  type="number"
                  min={0}
                  value={drafts[p.id] ?? ''}
                  onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') save(p.id);
                  }}
                  className="w-24 px-3 py-1.5 border border-gray-200 rounded-lg font-body text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
                  aria-label={`Stock count for ${p.name}`}
                />
                <button
                  onClick={() => save(p.id)}
                  disabled={savingId === p.id}
                  className="btn-secondary text-xs py-1.5 px-3 gap-1.5"
                >
                  {savingId === p.id ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : savedId === p.id ? (
                    <Check size={13} />
                  ) : null}
                  {savedId === p.id ? 'Saved' : 'Update'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
