import { describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { buildRefundEmail, refundDestinationLabel } from '@/lib/email-service';
import { processRefundEvent } from '@/lib/square-webhook';

vi.mock('@/lib/email-outbox', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/email-outbox')>(),
  publishPersistedEmail: vi.fn(async () => true),
}));

const order = {
  id: 'ORDER_1', order_number: 'AJ-1184', customer_name: 'Gayathri Ramineni',
  email: 'buyer@example.com', total_price: 112.99,
};

function makeDb(row: Record<string, unknown> | null = order) {
  const runs: Array<{ sql: string; binds: unknown[] }> = [];
  function prepare(sql: string) {
    let binds: unknown[] = [];
    const st = {
      bind(...v: unknown[]) { binds = v; return st; },
      get sql() { return sql; }, get binds() { return binds; },
      async first() { return sql.includes('FROM orders') ? row : null; },
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
  return { db: { prepare, batch: vi.fn(async () => []) } as unknown as D1Database, runs };
}

const emails = (runs: Array<{ sql: string; binds: unknown[] }>) => runs.filter((r) => r.sql.includes('INSERT INTO email_outbox'));

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

  it('is queued as soon as Square reports the refund PENDING, with the card from Square', async () => {
    const { db, runs } = makeDb();
    await processRefundEvent(db, 'refund.created', {
      id: 'REFUND_P', payment_id: 'PAY', status: 'PENDING', amount_money: { amount: 11299, currency: 'USD' },
    }, async () => ({ totalAmount: 11299, refundedAmount: 0, cardBrand: 'VISA', cardLast4: '9268' }));
    const queued = emails(runs);
    expect(queued).toHaveLength(1);
    expect(queued[0].binds[1]).toBe('refund:REFUND_P');
    expect(JSON.parse(String(queued[0].binds[2]))).toEqual(['buyer@example.com']);
    expect(String(queued[0].binds[6])).toContain('full refund');
    expect(String(queued[0].binds[6])).toContain('Visa ending 9268');
  });

  it('says partial refund when less than the order total is refunded', async () => {
    const { db, runs } = makeDb();
    await processRefundEvent(db, 'refund.updated', {
      id: 'REFUND_C', payment_id: 'PAY', status: 'COMPLETED', amount_money: { amount: 2500, currency: 'USD' },
    }, async () => ({ totalAmount: 11299, refundedAmount: 2500 }));
    const html = String(emails(runs)[0].binds[6]);
    expect(html).toContain('partial refund');
    expect(html).toContain('$25.00');
    expect(html).toContain('Your original payment method');
  });

  it('sends nothing for orders without an email, failed refunds, or other Square channels', async () => {
    const noEmail = makeDb({ ...order, email: null });
    await processRefundEvent(noEmail.db, 'refund.created', { id: 'R', payment_id: 'P', status: 'PENDING', amount_money: { amount: 100, currency: 'USD' } }, async () => ({ totalAmount: 100, refundedAmount: 0 }));
    expect(emails(noEmail.runs)).toHaveLength(0);

    const failed = makeDb();
    await processRefundEvent(failed.db, 'refund.updated', { id: 'R', payment_id: 'P', status: 'FAILED', amount_money: { amount: 100, currency: 'USD' } }, async () => ({ totalAmount: 100, refundedAmount: 0 }));
    expect(emails(failed.runs)).toHaveLength(0);

    const pos = makeDb(null);
    await processRefundEvent(pos.db, 'refund.created', { id: 'R', payment_id: 'P', status: 'PENDING', amount_money: { amount: 100, currency: 'USD' } }, async () => ({ totalAmount: 100, refundedAmount: 0 }));
    expect(emails(pos.runs)).toHaveLength(0);
  });

  it('never fails the webhook when the email cannot be queued', async () => {
    const { db } = makeDb();
    (db as unknown as { prepare: (sql: string) => unknown }).prepare = ((orig) => (sql: string) => {
      if (sql.includes('order_items')) throw new Error('D1 down');
      return orig(sql);
    })((db as unknown as { prepare: (sql: string) => unknown }).prepare.bind(db));
    await expect(processRefundEvent(db, 'refund.created', {
      id: 'R', payment_id: 'P', status: 'PENDING', amount_money: { amount: 100, currency: 'USD' },
    }, async () => ({ totalAmount: 100, refundedAmount: 0 }))).resolves.toMatchObject({ handled: true });
  });
});
