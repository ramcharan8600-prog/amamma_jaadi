import { PRODUCTS } from '@/data/products';
import { DELIVERY_STATE_OPTIONS } from '@/lib/pricing';

export interface PickleStateSalesRow {
  stateCode: string;
  stateName: string;
  jars: number;
  products: { productId: string; productName: string; jars: number }[];
}

/** The database returns only grouped destination/product counts, never addresses. */
export interface PickleStateProductTotal {
  state_candidates: string;
  product_name: string;
  jars: number;
}

const pickleProducts = PRODUCTS.filter((product) => product.category === 'pickles');
const productByName = new Map(pickleProducts.map((product) => [product.name.trim().toLowerCase(), product]));
// Alaska/Hawaii are valid historical destinations even though checkout currently
// requires a manual shipping quote for them.
const states = [...DELIVERY_STATE_OPTIONS, { code: 'AK', name: 'Alaska' }, { code: 'HI', name: 'Hawaii' }];
const stateByCodeOrName = new Map(states.flatMap((state) => [
  [state.code, state] as const,
  [state.name.toUpperCase(), state] as const,
]));

function resolveState(candidatesJson: string) {
  // SQL builds this array from state fields only, in source-of-truth order.
  const candidates: unknown = JSON.parse(candidatesJson);
  if (!Array.isArray(candidates)) return undefined;
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const state = stateByCodeOrName.get(candidate.trim().replace(/\s+/g, ' ').toUpperCase());
    if (state) return state;
  }
  return undefined;
}

/** Merge legacy state spelling/case variants and count jars without refund deductions. */
export function getPickleSalesByState(totals: PickleStateProductTotal[]): PickleStateSalesRow[] {
  const rows = new Map<string, PickleStateSalesRow>();
  for (const total of totals) {
    const product = productByName.get(total.product_name.trim().toLowerCase());
    if (!product || !Number.isSafeInteger(total.jars) || total.jars <= 0) continue;
    const state = resolveState(total.state_candidates);
    const stateCode = state?.code ?? 'Unknown';
    let row = rows.get(stateCode);
    if (!row) {
      row = {
        stateCode,
        stateName: state?.name ?? 'Unknown',
        jars: 0,
        products: pickleProducts.map(({ id, name }) => ({ productId: id, productName: name, jars: 0 })),
      };
      rows.set(stateCode, row);
    }
    row.jars += total.jars;
    row.products.find(({ productId }) => productId === product.id)!.jars += total.jars;
  }
  return [...rows.values()].sort((a, b) => b.jars - a.jars || a.stateName.localeCompare(b.stateName));
}
