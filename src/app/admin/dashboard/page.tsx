'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { LogOut, BarChart3, Ticket, ClipboardList, ChefHat } from 'lucide-react';
import InventoryPanel from '@/components/admin/InventoryPanel';
import SoldOutDatesPanel from '@/components/admin/SoldOutDatesPanel';
import BlockedCustomersPanel from '@/components/admin/BlockedCustomersPanel';

/** Admin home: the toolbar (All Orders, Production, Taxes, Coupons, Analytics), sold-out dates and stock. */
export default function AdminDashboardPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);

  // Check auth (middleware handles redirect, this is for UI state)
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch('/api/auth');
        if (res.ok) {
          setAuthed(true);
        } else {
          router.push('/admin/login');
        }
      } catch {
        router.push('/admin/login');
      }
    };
    checkAuth();
  }, [router]);

  const handleLogout = async () => {
    await fetch('/api/auth', { method: 'DELETE' });
    router.push('/admin/login');
  };

  if (!authed) {
    return (
      <div className="section-padding py-16 text-center">
        <p className="font-body text-brand-charcoal/60">Checking authentication...</p>
      </div>
    );
  }

  return (
    <div className="section-padding py-8 sm:py-12">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap mb-8">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-brand-charcoal">
            Admin Dashboard
          </h1>
          <p className="font-body text-sm text-brand-charcoal/50">
            Manage orders and production
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/admin/orders" className="btn-primary text-xs gap-1.5">
            <ClipboardList size={14} /> All Orders
          </Link>
          <Link href="/admin/production" className="btn-secondary text-xs gap-1.5">
            <ChefHat size={14} /> Production Planning
          </Link>
          <Link href="/admin/taxes" className="btn-secondary text-xs gap-1.5">Tax records</Link>
          <Link href="/admin/coupons" className="btn-secondary text-xs gap-1.5">
            <Ticket size={14} /> Coupons
          </Link>
          <Link href="/admin/analytics" className="btn-secondary text-xs gap-1.5">
            <BarChart3 size={14} /> Analytics
          </Link>
          <button onClick={handleLogout} className="btn-secondary text-xs gap-1.5">
            <LogOut size={14} /> Logout
          </button>
        </div>
      </div>

      {/* Sold-out pickup dates */}
      <SoldOutDatesPanel />

      {/* Inventory */}
      <InventoryPanel />

      <BlockedCustomersPanel />
    </div>
  );
}
