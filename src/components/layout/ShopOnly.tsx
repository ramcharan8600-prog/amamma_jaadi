'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { SHOP_CLOSED } from '@/lib/constants';

/** The shop's header, footer and WhatsApp button stay off admin pages, which have their own menu. */
export function isAdminPath(pathname: string | null): boolean {
  return pathname === '/admin' || Boolean(pathname?.startsWith('/admin/'));
}

export default function ShopOnly({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // While the shop is closed the closed notice stands on its own: no nav that
  // leads nowhere, no cart icon, no footer links.
  if (SHOP_CLOSED) return null;
  return isAdminPath(pathname) ? null : <>{children}</>;
}
