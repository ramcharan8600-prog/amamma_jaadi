'use client';

import { useEffect, useState } from 'react';

/**
 * Live stock counts for tracked products, read from GET /api/inventory.
 *
 * The fetch promise is cached at module scope, so every card on a page shares a
 * SINGLE request (3 pickle cards → 1 network call). Product listing pages stay
 * statically rendered and edge-cached; stock resolves right after hydration.
 *
 * A product missing from the map is UNTRACKED (sweets, gift boxes) and returns
 * `null` — meaning "no limit", never "sold out". Purchases are always enforced
 * server-side in create-session; this hook is presentation only.
 */
let stockPromise: Promise<Record<string, number>> | null = null;

function loadStock(): Promise<Record<string, number>> {
  if (!stockPromise) {
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

export function useStock(productId: string): { count: number | null; loaded: boolean } {
  const [state, setState] = useState<{ count: number | null; loaded: boolean }>({
    count: null,
    loaded: false,
  });

  useEffect(() => {
    let active = true;
    loadStock().then((map) => {
      if (!active) return;
      const has = Object.prototype.hasOwnProperty.call(map, productId);
      setState({ count: has ? map[productId] : null, loaded: true });
    });
    return () => {
      active = false;
    };
  }, [productId]);

  return state;
}
