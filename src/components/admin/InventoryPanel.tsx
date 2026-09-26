'use client';

import { useState, useEffect, useCallback } from 'react';
import { Boxes, Check, Loader2 } from 'lucide-react';
import { ASSORTED_BOX_PRODUCT_ID, PRODUCTS, isStockTracked, isBobbatluProduct } from '@/data/products';
import type { Product } from '@/types';
import { invalidateStock } from '@/hooks/useStock';

/**
 * Admin stock editor for pickle jars, ready-made Bobbatlu pieces and, in its
 * own section, whole Assorted Boxes (never mixed with loose-sweet counts).
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
      invalidateStock();
      setSavedId(productId);
      setTimeout(() => setSavedId(null), 1500);
    } catch {
      setError('Could not update stock.');
    } finally {
      setSavingId(null);
    }
  };

  const tracked = PRODUCTS.filter((p) => isStockTracked(p) && p.id !== ASSORTED_BOX_PRODUCT_ID);
  const boxes = PRODUCTS.filter((p) => p.id === ASSORTED_BOX_PRODUCT_ID);

  const renderRow = (p: Product) => {
    const current = stock[p.id] ?? 0;
    const isBobbatlu = isBobbatluProduct(p.id);
    const isBox = p.id === ASSORTED_BOX_PRODUCT_ID;
    const isOut = current <= 0;
    const isLow = current > 0 && current <= 5;
    const hint = isBobbatlu
      ? 'Count individual pieces. Orders beyond stock need 1 day to prepare.'
      : isBox ? 'Count whole boxes (11 Malpuri + 11 Malai Khaja each).' : 'Count jars.';
    const status = isOut
      ? (isBobbatlu ? '1-day preparation' : 'Out of stock')
      : `${current} ${isBobbatlu ? 'pieces ready' : isBox ? (current === 1 ? 'box in stock' : 'boxes in stock') : 'in stock'}`;
    return (
      <div
        key={p.id}
        className="flex items-center gap-3 flex-wrap bg-brand-cream rounded-lg px-3 py-2.5"
      >
        <span className="font-body text-sm font-medium text-brand-charcoal flex-1 min-w-[140px]">
          {p.name}
          <span className="block text-xs font-normal text-brand-charcoal/60">{hint}</span>
        </span>
        <span
          className={`font-body text-xs px-2 py-0.5 rounded-full ${
            isOut && !isBobbatlu
              ? 'bg-red-50 text-red-700'
              : isLow
                ? 'bg-amber-50 text-amber-700'
                : 'bg-green-50 text-green-700'
          }`}
        >
          {status}
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
  };

  return (
    <div className="card p-6 mb-8">
      <div className="flex items-center gap-2 mb-4">
        <Boxes size={20} className="text-brand-gold" />
        <h2 className="font-display text-lg font-semibold text-brand-charcoal">
          Inventory — Pickles & Bobbatlu
        </h2>
        <span className="font-body text-xs text-brand-charcoal/40 ml-1">
          counts drop automatically with each paid order
        </span>
      </div>

      {error && <p className="font-body text-sm text-red-600 mb-3">{error}</p>}

      {loading ? (
        <p className="font-body text-sm text-brand-charcoal/40">Loading stock…</p>
      ) : (
        <>
          <div className="space-y-2">{tracked.map(renderRow)}</div>
          {boxes.length > 0 && (
            <section aria-labelledby="assorted-box-stock" className="mt-6 pt-5 border-t border-brand-cream-dark">
              <h3 id="assorted-box-stock" className="font-display text-base font-semibold text-brand-charcoal">
                Assorted Box stock
              </h3>
              <p className="font-body text-xs text-brand-charcoal/60 mt-0.5 mb-3">
                Separate from loose Malpuri and Malai Khaja. At 0 the box shows Out of Stock on the website.
              </p>
              <div className="space-y-2">{boxes.map(renderRow)}</div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
