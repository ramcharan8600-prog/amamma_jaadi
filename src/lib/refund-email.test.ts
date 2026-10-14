import { describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { buildRefundEmail, refundDestinationLabel } from '@/lib/email-service';
import { processRefundEvent, reconcileSquareRefunds } from '@/lib/square-webhook';

vi.mock('@/lib/email-outbox', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/email-outbox')>(),
  publishPersistedEmail: vi.fn(async () => true),
}));

const order = {
  id: 'ORDER_1', order_number: 'AJ-1184', customer_name: 'Gayathri Ramineni',
  email: 'buyer@example.com', total_price: 112.99,
};

function makeDb(row: Record<string, unknown> | null = order, state: Record<string, unknown> | null = null) {
  const runs: Array<{ sql: string; binds: unknown[] }> = [];
  const batches: Array<Array<{ sql: string }>> = [];
  function prepare(sql: string) {
    let binds: unknown[] = [];
    const st = {
      bind(...v: unknown[]) { binds = v; return st; },
      get sql() { return sql; }, get binds() { return binds; },
      async first() {
        if (sql.includes('AS recorded')) return state;
        return sql.includes('FROM orders') ? row : null;
      },
      async all() {
        return { results: [
          { product_name: 'Kova Bobbatlu', quantity: 1, selected_tier: 16 },
          { product_name: 'Assorted Box — Malpuri & Malai Khaja', quantity: 1, selected_tier: 22 },
        ] };
      },
      async run() { runs.push({ sql, binds }); return {}; },
    };
    return st;
  }
  const batch = vi.fn(async (input: Array<{ sql: string }>) => { batches.push(input); return []; });
  return { db: { prepare, batch } as unknown as D1Database, runs, batches };
}

const emails = (runs: Array<{ sql: string; binds: unknown[] }>) => runs.filter((r) => r.sql.includes('INSERT INTO email_outbox'));

const NOW = '2026-10-15T15:00:00Z';

describe('customer refund email (owner template, AJ-1189)', () => {
  it('matches the approved template', () => {
    const email = buildRefundEmail({
      to: 'buyer@example.com', refundId: 'R1', orderNumber: 'AJ-1184', customerName: 'Gayathri Ramineni',
      items: [{ name: 'Kova Bobbatlu', selectedTier: 16, quantity: 1 }, { name: 'Assorted Box — Malpuri & Malai Khaja', selectedTier: 22, quantity: 1 }],
      amount: 112.99, full: true, refundedTo: 'Visa ending 9268', initiatedOn: new Date('2026-10-14T15:00:00Z'),
    });
    expect(email.subject).toBe('Your refund for order AJ-1184 has been initiated');
    expect(email.cc).toEqual(['amamma.jaadi@gmail.com']);
    expect(email.dedupeKey).toBe('refund:R1');
    for (const text of [
      'Your refund has been initiated', 'Hi Gayathri Ramineni,',
      'We have initiated a full refund for your order <strong>AJ-1184</strong> from our end.',
      'Kova Bobbatlu (16 pcs), Assorted Box — Malpuri &amp; Malai Khaja (22 pcs)',
      '$112.99', 'Visa ending 9268', 'Oct 14, 2026', '<strong>7 business days</strong>',
      'WhatsApp us at 510-574-5578', 'Team Amamma Jaadi',
    ]) expect(email.html).toContain(text);
  });

  it('names the card, or falls back when Square has no card', () => {
    expect(refundDestinationLabel('VISA', '9268')).toBe('Visa ending 9268');
    expect(refundDestinationLabel('AMERICAN_EXPRESS', '1005')).toBe('American Express ending 1005');
    expect(refundDestinationLabel(undefined, undefined)).toBe('Your original payment method');
  });

  it('waits for COMPLETED: a pending refund changes nothing and sends nothing', async () => {
    const { db, runs, batches } = makeDb();
    const lookup = vi.fn();
    await processRefundEvent(db, 'refund.created', {
      id: 'REFUND_P', payment_id: 'PAY', status: 'PENDING', amount_money: { amount: 11299, currency: 'USD' }, created_at: NOW,
    }, lookup);
    expect(emails(runs)).toHaveLength(0);
    expect(batches).toHaveLength(0);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('marks the order refunded and queues the email together when the refund completes', async () => {
    const { db, runs, batches } = makeDb();
    await processRefundEvent(db, 'refund.updated', {
      id: 'REFUND_C1', payment_id: 'PAY', status: 'COMPLETED', amount_money: { amount: 11299, currency: 'USD' }, created_at: NOW,
    }, async () => ({ totalAmount: 11299, refundedAmount: 11299, cardBrand: 'VISA', cardLast4: '9268' }));
    expect(batches[0].some((st) => st.sql.includes('UPDATE orders SET payment_status'))).toBe(true);
    const queued = emails(runs);
    expect(queued).toHaveLength(1);
    expect(queued[0].binds[1]).toBe('refund:REFUND_C1');
    expect(JSON.parse(String(queued[0].binds[2]))).toEqual(['buyer@example.com']);
    expect(String(queued[0].binds[6])).toContain('full refund');
    expect(String(queued[0].binds[6])).toContain('Visa ending 9268');
  });

  it('does not email refunds from before the feature shipped (they were emailed by hand)', async () => {
    const { db, runs, batches } = makeDb();
    await processRefundEvent(db, 'refund.updated', {
      id: 'OLD', payment_id: 'PAY', status: 'COMPLETED', amount_money: { amount: 11299, currency: 'USD' }, created_at: '2026-10-14T09:40:00Z',
    }, async () => ({ totalAmount: 11299, refundedAmount: 11299 }));
    expect(batches).toHaveLength(1);
    expect(emails(runs)).toHaveLength(0);
  });

  it('says partial refund when less than the order total is refunded', async () => {
    const { db, runs } = makeDb();
    await processRefundEvent(db, 'refund.updated', {
      id: 'REFUND_C', payment_id: 'PAY', status: 'COMPLETED', amount_money: { amount: 2500, currency: 'USD' }, created_at: NOW,
    }, async () => ({ totalAmount: 11299, refundedAmount: 2500 }));
    const html = String(emails(runs)[0].binds[6]);
    expect(html).toContain('partial refund');
    expect(html).toContain('$25.00');
    expect(html).toContain('Your original payment method');
  });

  it('sends nothing for orders without an email, failed refunds, or other Square channels', async () => {
    const noEmail = makeDb({ ...order, email: null });
    await processRefundEvent(noEmail.db, 'refund.updated', { id: 'R', payment_id: 'P', status: 'COMPLETED', amount_money: { amount: 100, currency: 'USD' }, created_at: NOW }, async () => ({ totalAmount: 100, refundedAmount: 100 }));
    expect(emails(noEmail.runs)).toHaveLength(0);

    const failed = makeDb();
    await processRefundEvent(failed.db, 'refund.updated', { id: 'R', payment_id: 'P', status: 'FAILED', amount_money: { amount: 100, currency: 'USD' } }, async () => ({ totalAmount: 100, refundedAmount: 0 }));
    expect(emails(failed.runs)).toHaveLength(0);

    const pos = makeDb(null);
    await processRefundEvent(pos.db, 'refund.updated', { id: 'R', payment_id: 'P', status: 'COMPLETED', amount_money: { amount: 100, currency: 'USD' }, created_at: NOW }, async () => ({ totalAmount: 100, refundedAmount: 100 }));
    expect(emails(pos.runs)).toHaveLength(0);
  });

  it('never fails the webhook when the email cannot be queued', async () => {
    const { db } = makeDb();
    (db as unknown as { prepare: (sql: string) => unknown }).prepare = ((orig) => (sql: string) => {
      if (sql.includes('order_items')) throw new Error('D1 down');
      return orig(sql);
    })((db as unknown as { prepare: (sql: string) => unknown }).prepare.bind(db));
    await expect(processRefundEvent(db, 'refund.updated', {
      id: 'R', payment_id: 'P', status: 'COMPLETED', amount_money: { amount: 100, currency: 'USD' }, created_at: NOW,
    }, async () => ({ totalAmount: 100, refundedAmount: 100 }))).resolves.toMatchObject({ handled: true, updated: true });
  });

  describe('15-minute safety net (missed webhooks)', () => {
    const completed = { id: 'MISSED', payment_id: 'PAY', status: 'COMPLETED', amount_money: { amount: 11299, currency: 'USD' }, created_at: NOW };
    const lookup = async () => ({ totalAmount: 11299, refundedAmount: 11299 });

    it('applies a refund Square has but the website never heard about', async () => {
      const { db, runs, batches } = makeDb(order, { email: 'buyer@example.com', recorded: 0, emailed: 0 });
      const result = await reconcileSquareRefunds(db, { listRefunds: async () => [completed], lookupPayment: lookup, now: new Date(NOW) });
      expect(result).toEqual({ checked: 1, applied: 1, failed: 0 });
      expect(batches).toHaveLength(1);
      expect(emails(runs)).toHaveLength(1);
    });

    it('skips refunds already applied and emailed, pending refunds, and in-store sales', async () => {
      const done = makeDb(order, { email: 'buyer@example.com', recorded: 1, emailed: 1 });
      const pending = { ...completed, id: 'PENDING', status: 'PENDING' };
      const result = await reconcileSquareRefunds(done.db, { listRefunds: async () => [completed, pending], lookupPayment: lookup, now: new Date(NOW) });
      expect(result).toEqual({ checked: 1, applied: 0, failed: 0 });
      expect(done.batches).toHaveLength(0);

      const pos = makeDb(null, null);
      await reconcileSquareRefunds(pos.db, { listRefunds: async () => [completed], lookupPayment: lookup, now: new Date(NOW) });
      expect(pos.batches).toHaveLength(0);
    });

    it('looks back 3 days and keeps going when one refund fails', async () => {
      const { db } = makeDb(order, { email: 'buyer@example.com', recorded: 0, emailed: 0 });
      const listRefunds = vi.fn(async () => [completed, { ...completed, id: 'SECOND' }]);
      let calls = 0;
      const result = await reconcileSquareRefunds(db, {
        listRefunds,
        lookupPayment: async () => { if (calls++ === 0) throw new Error('Square timeout'); return { totalAmount: 11299, refundedAmount: 11299 }; },
        now: new Date(NOW),
      });
      expect(listRefunds).toHaveBeenCalledWith(new Date('2026-10-12T15:00:00Z'));
      expect(result.failed).toBe(1);
      expect(result.applied).toBe(1);
    });
  });
});
