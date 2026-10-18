'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { BarChart3, ChefHat, ClipboardList, Home, LogOut, Settings, Store } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** The five admin sections. `match` lists every page that belongs to the section. */
export const ADMIN_SECTIONS: Array<{ label: string; href: string; icon: LucideIcon; match: string[] }> = [
  { label: 'Today', href: '/admin/dashboard', icon: Home, match: ['/admin/dashboard'] },
  { label: 'Orders', href: '/admin/orders', icon: ClipboardList, match: ['/admin/orders'] },
  { label: 'Kitchen', href: '/admin/production', icon: ChefHat, match: ['/admin/production'] },
  { label: 'Reports', href: '/admin/reports', icon: BarChart3, match: ['/admin/reports', '/admin/analytics', '/admin/taxes'] },
  { label: 'Settings', href: '/admin/settings', icon: Settings, match: ['/admin/settings', '/admin/coupons'] },
];

export function adminSectionFor(pathname: string): string | null {
  return ADMIN_SECTIONS.find((s) => s.match.some((m) => pathname === m || pathname.startsWith(`${m}/`)))?.label ?? null;
}

/**
 * Every admin page: a slim top bar (sections on wide screens, View shop, Log out) and,
 * on phones, a bottom tab bar within thumb reach. The login page gets neither.
 */
export default function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  if (pathname.startsWith('/admin/login')) return <>{children}</>;

  const current = adminSectionFor(pathname);
  const logout = async () => {
    await fetch('/api/auth', { method: 'DELETE' }).catch(() => null);
    router.push('/admin/login');
  };

  return (
    <div className="min-h-screen bg-brand-cream/40 pb-20 lg:pb-0">
      <header className="sticky top-0 z-40 bg-brand-maroon text-white shadow-sm">
        <div className="section-padding h-14 flex items-center gap-4">
          <Link href="/admin/dashboard" className="font-display font-bold tracking-wide text-brand-gold-light whitespace-nowrap">
            Amamma Jaadi <span className="font-body text-xs font-semibold text-white/70 align-middle">Admin</span>
          </Link>
          <nav aria-label="Admin sections" className="hidden lg:flex items-center gap-1 ml-4">
            {ADMIN_SECTIONS.map(({ label, href, icon: Icon }) => (
              <Link
                key={label}
                href={href}
                aria-current={current === label ? 'page' : undefined}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-body text-sm font-medium transition-colors ${
                  current === label ? 'bg-white text-brand-maroon' : 'text-white/85 hover:bg-white/10'
                }`}
              >
                <Icon size={16} aria-hidden="true" /> {label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <Link href="/" className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-body text-xs text-white/85 hover:bg-white/10">
              <Store size={15} aria-hidden="true" /> View shop
            </Link>
            <button type="button" onClick={logout} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-body text-xs text-white/85 hover:bg-white/10">
              <LogOut size={15} aria-hidden="true" /> Log out
            </button>
          </div>
        </div>
      </header>

      {children}

      <nav
        aria-label="Admin sections (phone)"
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-brand-cream-dark pb-[env(safe-area-inset-bottom)]"
      >
        <ul className="grid grid-cols-5">
          {ADMIN_SECTIONS.map(({ label, href, icon: Icon }) => (
            <li key={label}>
              <Link
                href={href}
                aria-current={current === label ? 'page' : undefined}
                className={`flex flex-col items-center gap-0.5 py-2 font-body text-[11px] font-medium ${
                  current === label ? 'text-brand-maroon' : 'text-brand-charcoal/55'
                }`}
              >
                <Icon size={22} aria-hidden="true" strokeWidth={current === label ? 2.4 : 1.8} />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
