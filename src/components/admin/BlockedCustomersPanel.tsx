'use client';

import { useCallback, useEffect, useState } from 'react';
import { Ban, Loader2 } from 'lucide-react';
import type { BlockedCustomer } from '@/lib/blocked-customers';

/** (214) 555-0100 from 2145550100. */
function prettyPhone(digits: string): string {
  return digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : digits;
}

/**
 * Admin → Dashboard: customers whose orders are refused at checkout (by phone,
 * or the email saved with it). Admin only; never shown to other customers.
 */
export default function BlockedCustomersPanel() {
  const [list, setList] = useState<BlockedCustomer[] | null>(null);
  const [form, setForm] = useState({ phone: '', name: '', orderNumber: '', email: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const call = useCallback(async (method: 'GET' | 'POST' | 'DELETE', body?: unknown) => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/admin/blocked-customers', {
        method, cache: 'no-store',
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setList(data.blocked ?? []);
      return true;
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Could not update the blocked list.');
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { call('GET'); }, [call]);

  const add = async () => {
    if (await call('POST', form)) setForm({ phone: '', name: '', orderNumber: '', email: '', reason: '' });
  };
  const field = (key: keyof typeof form, label: string, placeholder: string) => (
    <label className="block">
      <span className="block font-body text-[11px] font-semibold text-brand-charcoal/70">{label}</span>
      <input
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        placeholder={placeholder}
        className="input-field py-1.5 text-sm"
        aria-label={label}
      />
    </label>
  );

  return (
    <section aria-labelledby="blocked-customers-title" className="card p-5 mb-6">
      <div className="flex items-center gap-2 mb-1">
        <Ban size={20} className="text-brand-maroon" />
        <h2 id="blocked-customers-title" className="font-display text-lg font-semibold text-brand-charcoal">Blocked customers</h2>
        {busy && <Loader2 size={14} className="animate-spin text-brand-charcoal/50" aria-label="Saving" />}
      </div>
      <p className="font-body text-xs text-brand-charcoal/60 mb-4">
        Checkout refuses these phone numbers (and the email saved with them) when they continue to payment.
      </p>
      <div className="grid sm:grid-cols-5 gap-2 items-end">
        {field('phone', 'Phone *', '(214) 555-0100')}
        {field('name', 'Name', 'Customer name')}
        {field('orderNumber', 'Order #', 'AJ-1228')}
        {field('email', 'Email', 'optional')}
        <button type="button" onClick={add} disabled={busy || !form.phone.trim()} className="btn-primary text-xs py-2 px-4 disabled:opacity-50">
          Block
        </button>
      </div>
      {error && <p role="alert" className="font-body text-sm text-red-600 mt-3">{error}</p>}
      {list && list.length > 0 && (
        <ul className="mt-4 divide-y divide-brand-cream-dark">
          {list.map((c) => (
            <li key={c.phone} className="flex items-center justify-between gap-3 py-2 font-body text-sm">
              <span>
                <strong>{prettyPhone(c.phone)}</strong>
                {c.name && ` · ${c.name}`}
                {c.order_number && ` · ${c.order_number}`}
                {c.email && <span className="text-brand-charcoal/60"> · {c.email}</span>}
              </span>
              <button
                type="button"
                onClick={() => { if (window.confirm(`Unblock ${prettyPhone(c.phone)}?`)) call('DELETE', { phone: c.phone }); }}
                disabled={busy}
                className="text-xs font-semibold text-brand-maroon hover:underline disabled:opacity-50"
              >
                Unblock
              </button>
            </li>
          ))}
        </ul>
      )}
      {list && list.length === 0 && <p className="font-body text-sm text-brand-charcoal/60 mt-3">No one is blocked.</p>}
    </section>
  );
}
