import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestD1 } from '@/lib/test-utils/d1';
import { blockCustomer, isBlockedCustomer, listBlockedCustomers, unblockCustomer } from './blocked-customers';

let fixture: ReturnType<typeof createTestD1>;
beforeEach(() => {
  fixture = createTestD1();
  fixture.sqlite.exec(readFileSync(new URL('./d1-schema.sql', import.meta.url), 'utf8'));
});
afterEach(() => fixture.sqlite.close());

it('blocks a phone number however it is typed, plus the email saved with it, and can unblock', async () => {
  expect(await blockCustomer(fixture.db, { phone: '+1 (214) 555-0100', email: ' Blocked@Example.com ', name: 'Test', orderNumber: 'AJ-1228' })).toBe('2145550100');
  for (const typed of ['2145550100', '(214) 555-0100', '+12145550100', '214-555-0100']) {
    expect(await isBlockedCustomer(fixture.db, typed, 'someone@else.com')).toBe(true);
  }
  expect(await isBlockedCustomer(fixture.db, '9725550111', 'blocked@example.com')).toBe(true);
  expect(await isBlockedCustomer(fixture.db, '9725550111', 'friend@example.com')).toBe(false);
  expect(await isBlockedCustomer(fixture.db, '9725550111', '')).toBe(false);
  expect((await listBlockedCustomers(fixture.db)).map((c) => [c.phone, c.order_number])).toEqual([['2145550100', 'AJ-1228']]);
  expect(await unblockCustomer(fixture.db, '(214) 555-0100')).toBe(true);
  expect(await isBlockedCustomer(fixture.db, '2145550100')).toBe(false);
});

it('refuses invalid phone numbers and fails open if the table is missing', async () => {
  expect(await blockCustomer(fixture.db, { phone: '12345' })).toBeNull();
  fixture.sqlite.exec('DROP TABLE blocked_customers');
  const original = console.error;
  console.error = () => {};
  try {
    expect(await isBlockedCustomer(fixture.db, '2145550100')).toBe(false);
  } finally {
    console.error = original;
  }
});
