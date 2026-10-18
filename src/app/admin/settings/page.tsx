'use client';

import Link from 'next/link';
import { ChevronRight, Ticket } from 'lucide-react';
import DeliveryPausePanel from '@/components/admin/DeliveryPausePanel';
import SoldOutDatesPanel from '@/components/admin/SoldOutDatesPanel';
import BlockedCustomersPanel from '@/components/admin/BlockedCustomersPanel';

/**
 * Admin → Settings: everything that changes what customers can order, in one place —
 * delivery pauses and the weekly delivery limit, sold-out pickup dates, blocked
 * customers and coupons. Each panel saves on its own, right away.
 */
export default function AdminSettingsPage() {
  return (
    <div className="section-padding py-6 sm:py-10">
      <h1 className="font-display text-2xl sm:text-3xl font-bold text-brand-charcoal">Settings</h1>
      <p className="font-body text-sm text-brand-charcoal/60 mb-6">What customers can order and when. Changes apply right away.</p>

      <DeliveryPausePanel />
      <SoldOutDatesPanel />
      <BlockedCustomersPanel />

      <Link href="/admin/coupons" className="card p-5 flex items-center gap-3 hover:shadow-md transition-shadow">
        <Ticket size={20} className="text-brand-gold shrink-0" aria-hidden="true" />
        <span className="flex-1">
          <span className="block font-display text-lg font-semibold text-brand-charcoal">Coupons</span>
          <span className="block font-body text-xs text-brand-charcoal/60">Create coupons, turn them on or off, and see how each one sells.</span>
        </span>
        <ChevronRight size={18} className="text-brand-maroon" aria-hidden="true" />
      </Link>
    </div>
  );
}
