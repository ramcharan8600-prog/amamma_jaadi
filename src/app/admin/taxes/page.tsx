'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Download, RefreshCw } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { d1TimestampToBusinessDate, toBusinessDateString } from '@/lib/date';
import type { TaxReport, TaxReportRow } from '@/lib/tax-report';

const money = (cents: number | null) => cents == null ? '—' : formatCurrency(cents / 100);
const allocationFields = [
  ['taxableMerchandiseCents', 'Taxable products refunded'], ['exemptMerchandiseCents', 'Exempt products refunded'],
  ['shippingCents', 'Shipping and fees refunded'], ['taxableShippingCents', 'Taxable portion of those charges'],
  ['taxCents', 'Sales tax refunded'],
] as const;

export default function TaxRecordsPage() {
  const router = useRouter();
  const currentDate = toBusinessDateString(new Date());
  const [year, setYear] = useState(Number(currentDate.slice(0, 4)));
  const [quarter, setQuarter] = useState(Math.ceil(Number(currentDate.slice(5, 7)) / 3));
  const [report, setReport] = useState<TaxReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<TaxReportRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setReport(null); setEditing(null);
    fetch(`/api/admin/tax-report?year=${year}&quarter=${quarter}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        if (response.status === 401) { router.push('/admin/login'); return; }
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not load tax records.');
        if (!controller.signal.aborted) setReport(data);
      }).catch(e => { if (!controller.signal.aborted) setError(e.message || 'Could not load tax records.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [year, quarter, revision, router]);

  async function saveAllocation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    const values: Record<string, number> = {};
    for (const [field] of allocationFields) {
      const value = String(form.get(field) ?? '');
      if (!/^\d+(?:\.\d{1,2})?$/.test(value)) { setSaveError('Use dollar amounts with no more than two decimal places.'); return; }
      values[field] = Math.round(Number(value) * 100);
    }
    setSaving(true); setSaveError('');
    try {
      const response = await fetch('/api/admin/tax-report', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refundId: editing.event_id, ...values, note: form.get('note') }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save.');
      setEditing(null); setRevision(value => value + 1);
    } catch (e) { setSaveError(e instanceof Error ? e.message : 'Could not save.'); }
    finally { setSaving(false); }
  }

  const download = (view: string) => `/api/admin/tax-report?year=${year}&quarter=${quarter}&format=csv&view=${view}`;
  const s = report?.summary;
  return <div className="section-padding py-8 sm:py-12">
    <Link href="/admin/dashboard" className="inline-flex items-center gap-2 text-sm text-brand-maroon mb-6"><ArrowLeft size={16} /> Dashboard</Link>
    <h1 className="font-display text-3xl font-bold">Quarterly tax records</h1>
    <p className="mt-2 text-sm text-brand-charcoal/70">Website sales and refunds, grouped by transaction date in US Central time.</p>
    <div className="flex flex-wrap items-end gap-3 my-6">
      <label className="text-sm">Year<input aria-label="Year" type="number" min="2020" max="2100" className="input-field mt-1 w-28"
        value={year} onChange={e => setYear(Number(e.target.value))} disabled={saving} /></label>
      <label className="text-sm">Quarter<select aria-label="Quarter" className="input-field mt-1 w-40" value={quarter}
        onChange={e => setQuarter(Number(e.target.value))} disabled={saving}>
        <option value={1}>Q1 · Jan–Mar</option><option value={2}>Q2 · Apr–Jun</option>
        <option value={3}>Q3 · Jul–Sep</option><option value={4}>Q4 · Oct–Dec</option>
      </select></label>
      <button className="btn-secondary text-sm" onClick={() => setRevision(value => value + 1)} disabled={loading || saving}>
        <RefreshCw size={16} /> Refresh</button>
    </div>
    {loading && <p role="status">Loading tax records…</p>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {report && s && <>
      {report.environment === 'sandbox' && <p className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 mb-5 font-semibold">Sandbox test records — do not use these amounts for filing.</p>}
      {report.reportingExclusions.length > 0 && <p className="text-sm text-brand-charcoal/70 mb-5">
        {report.reportingExclusions.length} owner-confirmed test order(s) excluded from tax reports across all dates: {report.reportingExclusions.map(order => order.order_number).join(', ')}.
        {' '}Original order records are preserved. Exclusion details are included in the Quarter summary CSV.
      </p>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {[
          ['Sales tax collected', money(s.collectedTaxCents)], ['Allocated tax refunds', money(s.allocatedRefundTaxCents)],
          ['Net recorded tax', money(s.netRecordedTaxCents)], ['Paid orders', String(s.salesCount)],
        ].map(([label, value]) => <div key={label} className="card p-4"><p className="text-xs text-brand-charcoal/60">{label}</p><p className="text-xl font-semibold mt-1">{value}</p></div>)}
      </div>
      <p className="text-sm text-brand-charcoal/70 mb-5">These are recorded collections, not a completed tax return. Product and shipping totals below include records with a saved breakdown. Other sales channels and filing adjustments are separate.</p>
      {(s.reviewCount > 0 || report.refundGaps.length > 0) && <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 mb-5 text-sm">
        <strong>Review before filing:</strong> {s.reviewCount} transaction(s) need attention. {s.unallocatedRefundCount} refund(s) need a breakdown.
        {report.refundGaps.length > 0 && <p className="mt-2">{report.refundGaps.length} order(s) have refund totals without matching dated events. They cannot be assigned to a quarter yet.</p>}
      </div>}
      <div className="flex flex-wrap gap-2 mb-6">
        {[['transactions', 'Transactions CSV'], ['items', 'Product details CSV'], ['summary', 'Quarter summary CSV'], ['refund-history', 'Refund audit CSV']].map(([view, label]) =>
          <a key={view} href={download(view)} className="btn-secondary text-xs"><Download size={14} /> {label}</a>)}
      </div>
      <div className="mb-7">
        <div className="card p-4"><h2 className="font-semibold mb-3">Recorded sales breakdown</h2>
          <dl className="space-y-2 text-sm">{[
            ['Taxable products', s.taxableMerchandiseCents], ['Exempt products', s.exemptMerchandiseCents],
            ['Shipping and fees charged', s.shippingCents], ['Taxable portion of shipping and fees', s.taxableShippingCents],
            ['Customer payments including tax', s.grossReceiptsCents], ['Customer refunds including tax', s.refundCents],
          ].map(([label, amount]) => <div key={label} className="flex justify-between gap-3"><dt>{label}</dt><dd>{money(Number(amount))}</dd></div>)}</dl>
        </div>
      </div>
      <h2 className="font-semibold mb-3">Transactions · Q{quarter} {year}</h2>
      <div className="overflow-x-auto"><table className="w-full text-left text-xs">
        <thead><tr className="border-b">{['Date', 'Order / event', 'State', 'Taxable products', 'Exempt products', 'Shipping and fees', 'Taxable shipping and fees', 'Tax', 'Total', 'Review'].map(label => <th key={label} className="p-2 whitespace-nowrap">{label}</th>)}</tr></thead>
        <tbody>{report.rows.map(row => <tr key={`${row.event_type}-${row.event_id}`} className="border-b align-top">
          <td className="p-2 whitespace-nowrap">{d1TimestampToBusinessDate(row.occurred_at)}</td>
          <td className="p-2 whitespace-nowrap">{row.order_number}<br />{row.event_type === 'sale' ? 'Sale' : 'Refund'}</td>
          <td className="p-2">{row.destination_state || '—'}</td>
          {[row.taxable_merchandise_cents, row.exempt_merchandise_cents, row.shipping_cents, row.taxable_shipping_cents, row.tax_cents, row.total_cents].map((value, index) =>
            <td key={index} className="p-2 whitespace-nowrap">{value === null ? '—' : money(value * (row.event_type === 'refund' ? -1 : 1))}</td>)}
          <td className="p-2 min-w-52 max-w-80"><span>{row.issues.join(' ') || 'Recorded'}</span>
            {row.event_type === 'refund' && row.policy_version && <button disabled={saving} className="block mt-1 font-semibold text-brand-maroon underline"
              onClick={() => { setEditing(row); setSaveError(''); }}>Record refund breakdown</button>}
          </td>
        </tr>)}</tbody>
      </table></div>
      {report.rows.length === 0 && <p className="py-6 text-sm">No paid sales or recorded refunds in this quarter.</p>}
      {editing && <form key={editing.event_id} onSubmit={saveAllocation} className="card p-5 my-6">
        <h2 className="font-semibold">Refund breakdown · {editing.order_number} · {money(editing.total_cents)}</h2>
        <p className="text-sm my-2">Enter amounts from the actual refund receipt. This saves records only; it does not send money. The taxable shipping portion is included in shipping, not added again.</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {allocationFields.map(([field, label]) => <label key={field} className="text-sm">{label} ($)<input required name={field} inputMode="decimal" placeholder="0.00" className="input-field mt-1" disabled={saving} /></label>)}
          <label className="text-sm">Receipt reference / reason<input required minLength={5} maxLength={500} name="note" className="input-field mt-1" disabled={saving} /></label>
        </div>
        {saveError && <p role="alert" className="text-red-700 text-sm mt-3">{saveError}</p>}
        <div className="flex gap-3 mt-4"><button className="btn-primary text-sm" disabled={saving}>{saving ? 'Saving…' : 'Save breakdown'}</button>
          <button type="button" className="btn-secondary text-sm" disabled={saving} onClick={() => setEditing(null)}>Cancel</button></div>
      </form>}
      {report.refundGaps.length > 0 && <div className="mt-6"><h2 className="font-semibold mb-2">Refunds to reconcile · all dates</h2>
        <p className="text-sm mb-2">Match these with Square refund receipts before assigning a quarter.</p>
        {report.refundGaps.map(gap => <p key={gap.order_id} className="text-sm">{gap.order_number}: {money(gap.refunded_cents)} refunded; {money(gap.recorded_refunds_cents)} in dated records.</p>)}
      </div>}
      <p className="text-xs text-brand-charcoal/50 mt-6">Original sale records stay unchanged. Older sweets are recorded as owner-confirmed exempt, using the original order date. Refund corrections retain an audit trail. Generated {new Date(report.generatedAt).toLocaleString()}.</p>
    </>}
  </div>;
}
