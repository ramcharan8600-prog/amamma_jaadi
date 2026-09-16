'use client';

import { useEffect, useState } from 'react';

/**
 * Live stock counts for tracked products, read from GET /api/inventory.
 *
 * The fetch promise is cached at module scope, so every card on a page shares a
 * single shared request, refreshed at most once every 30 seconds. Product listing pages stay
 * statically rendered and edge-cached; stock resolves right after hydration.
 *
 * A missing product returns `null`. Bobbatlu treats that as made-to-order;
 * products with a hard stock limit retain their existing untracked behavior. Purchases are always enforced
 * server-side in create-session; this hook is presentation only.
 */
let stockPromise: Promise<Record<string, number>> | null = null;
let loadedAt = 0;

function loadStock(): Promise<Record<string, number>> {
  if (!stockPromise || Date.now() - loadedAt > 30_000) {
    loadedAt = Date.now();
    stockPromise = fetch('/api/inventory')
      .then((r) => (r.ok ? r.json() : { stock: {} }))
      .then((d) => (d?.stock ?? {}) as Record<string, number>)
      .catch(() => ({}) as Record<string, number>);
  }
  return stockPromise;
}

/** Force the next `useStock` call to refetch (used after an admin edit). */
export function invalidateStock(): void {
  stockPromise = null;
}

export function useStock(productId: string | null): { count: number | null; loaded: boolean } {
  const [state, setState] = useState<{ count: number | null; loaded: boolean }>({
    count: null,
    loaded: false,
  });

  useEffect(() => {
    if (!productId) return;
    let active = true;
    const refresh = () => loadStock().then((map) => {
      if (!active) return;
      const has = Object.prototype.hasOwnProperty.call(map, productId);
      setState({ count: has ? map[productId] : null, loaded: true });
    });
    void refresh();
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
      window.clearInterval(timer);
    };
  }, [productId]);

  return state;
}
