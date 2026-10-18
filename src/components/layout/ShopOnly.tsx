'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';

/** The shop's header, footer and WhatsApp button stay off admin pages, which have their own menu. */
export function isAdminPath(pathname: string | null): boolean {
  return pathname === '/admin' || Boolean(pathname?.startsWith('/admin/'));
}

export default function ShopOnly({ children }: { children: ReactNode }) {
  return isAdminPath(usePathname()) ? null : <>{children}</>;
}
