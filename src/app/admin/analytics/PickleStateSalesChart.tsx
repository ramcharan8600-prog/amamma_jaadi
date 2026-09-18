'use client';

import { useId, useState } from 'react';
import { PRODUCTS } from '@/data/products';
import type { PickleStateSalesRow } from '@/lib/pickle-state-sales';

const pickleProducts = PRODUCTS.filter(product => product.category === 'pickles');
const formatCount = (count: number) => count.toLocaleString('en-US');
const jarCount = (count: number) => `${formatCount(count)} ${count === 1 ? 'jar' : 'jars'}`;

type Props = { data: PickleStateSalesRow[]; year: number };

export default function PickleStateSalesChart(props: Props) {
  return <StateSalesChart key={props.year} {...props} />;
}

function StateSalesChart({ data, year }: Props) {
  const id = useId();
  const [productId, setProductId] = useState('all');
  const [showAll, setShowAll] = useState(false);
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const productName = pickleProducts.find(product => product.id === productId)?.name;
  const rows = data.map(row => ({
    ...row,
    selectedJars: productId === 'all' ? row.jars : row.products.find(product => product.productId === productId)?.jars ?? 0,
  })).filter(row => row.selectedJars > 0)
    .sort((a, b) => b.selectedJars - a.selectedJars || a.stateName.localeCompare(b.stateName));
  const visibleRows = showAll ? rows : rows.slice(0, 10);
  const maximum = rows[0]?.selectedJars ?? 1;
  const total = rows.reduce((sum, row) => sum + row.selectedJars, 0);

  return (
    <section className="card p-5 mb-8" aria-labelledby={`${id}-title`}>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div>
          <h3 id={`${id}-title`} className="font-display text-base font-semibold text-brand-charcoal mb-2">
            Pickle Jars Sold by State
          </h3>
          <p className="font-body text-xs text-brand-charcoal/60">
            {year === 2026 ? 'July–December' : 'January–December'} {year} · Paid orders · Pickup counts under Texas
          </p>
        </div>
        <label htmlFor="pickle-state-product" className="font-body text-xs font-medium text-brand-charcoal w-full sm:w-auto">
          Pickle product
          <select id="pickle-state-product" className="input-field block mt-2 w-full sm:w-56" value={productId}
            onChange={event => {
              setProductId(event.target.value);
              setShowAll(false);
              setSelectedState(null);
            }}>
            <option value="all">All Pickles</option>
            {pickleProducts.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}
          </select>
        </label>
      </div>

      {rows.length === 0 ? <p role="status" className="font-body text-sm text-brand-charcoal/60 py-6">
        No {productName ? `${productName} jars` : 'pickle jars'} sold in {year} yet.
      </p> : <>
        <div className="flex flex-wrap justify-between gap-2 font-body text-xs mb-3">
          <p className="text-brand-charcoal"><strong>{jarCount(total)}</strong> total</p>
          <p className="text-brand-charcoal/60">Hover or select a state for the product breakdown.</p>
        </div>
        {rows.some(row => row.stateCode === 'Unknown') && <p className="font-body text-xs text-brand-charcoal/60 mb-3">
          Orders without a recognized delivery state are grouped as Unknown.
        </p>}
        <ul aria-label="Pickle Jars Sold by State" className="space-y-1">
          {visibleRows.map(row => {
            const selected = selectedState === row.stateCode;
            return <li key={row.stateCode}>
              <button type="button"
                className={`grid grid-cols-[6rem_minmax(0,1fr)_3.5rem] sm:grid-cols-[10rem_minmax(0,1fr)_4rem] items-center gap-3 w-full min-h-11 py-2 px-1 rounded-lg text-left font-body text-xs sm:text-sm hover:bg-brand-cream focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-maroon ${selected ? 'bg-brand-cream' : ''}`}
                aria-label={`${row.stateName}: ${jarCount(row.selectedJars)}${productName ? ` of ${productName}` : ''}. View product breakdown`}
                aria-expanded={selected} aria-controls={selected ? `${id}-${row.stateCode}-details` : undefined}
                onMouseEnter={() => setSelectedState(row.stateCode)} onFocus={() => setSelectedState(row.stateCode)} onClick={() => setSelectedState(row.stateCode)}>
                <span className="text-brand-charcoal font-medium break-words">{row.stateName}</span>
                <span aria-hidden="true" className="block w-full h-5 bg-brand-cream-dark rounded-r">
                  <span className="block h-full min-w-1 bg-brand-maroon/80 rounded-r" style={{ width: `${row.selectedJars / maximum * 100}%` }} />
                </span>
                <span aria-hidden="true" className="text-right text-brand-charcoal tabular-nums">{formatCount(row.selectedJars)}</span>
              </button>
              {selected && <div id={`${id}-${row.stateCode}-details`} role="region" aria-label={`${row.stateName} product breakdown`}
                className="font-body text-xs bg-brand-cream rounded-lg px-3 py-3 mt-1 mb-3 text-brand-charcoal">
                <p className="font-semibold mb-2">{row.stateName}: {jarCount(row.jars)} across all pickles</p>
                <dl className="grid gap-x-5 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
                  {pickleProducts.map(product => <div key={product.id} className="flex flex-wrap justify-between gap-x-2">
                    <dt>{product.name}</dt>
                    <dd className="font-medium">{jarCount(row.products.find(item => item.productId === product.id)?.jars ?? 0)}</dd>
                  </div>)}
                </dl>
              </div>}
            </li>;
          })}
        </ul>
        <div aria-hidden="true" className="grid grid-cols-[6rem_minmax(0,1fr)_3.5rem] sm:grid-cols-[10rem_minmax(0,1fr)_4rem] gap-3 px-1 font-body text-[10px] text-brand-charcoal/60 mt-2">
          <span />
          <div className="flex justify-between border-t border-brand-cream-dark pt-2"><span>0</span><span>Jars sold</span><span>{formatCount(maximum)}</span></div>
        </div>
        {rows.length > 10 && <button type="button" className="btn-secondary text-sm mt-4" aria-expanded={showAll}
          onClick={() => { setShowAll(value => !value); setSelectedState(null); }}>
          {showAll ? 'Show top 10 states' : `Show all states (${rows.length})`}
        </button>}
      </>}
    </section>
  );
}
