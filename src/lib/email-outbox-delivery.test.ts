import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  prepareEmailOutboxInsert,
  processEmailOutboxMessage,
  type EmailDeliverySettings,
  type EmailOutboxPayload,
} from '@/lib/email-outbox';
import { createTestD1 } from '@/lib/test-utils/d1';

const RECIPIENT = 'ramcharan8600@gmail.com';
const sandbox: EmailDeliverySettings = {
  apiKey: 'fake-sandbox-sending-key',
  fromEmail: 'sandbox@amammajaadi.com',
  environment: 'sandbox',
  sandboxRecipient: RECIPIENT,
};
const schema = readFileSync(new URL('./migrations/007-email-outbox.sql', import.meta.url), 'utf8');
const fetchMock = vi.fn<typeof fetch>();

function fixture() {
  const database = createTestD1();
  database.sqlite.exec(schema);
  return database;
}

let f: ReturnType<typeof fixture>;

async function addEmail(overrides: Partial<EmailOutboxPayload> = {}) {
  const payload: EmailOutboxPayload = {
    to: RECIPIENT,
    subject: 'Order Confirmation - AJ-TEST',
    html: '<h1>Sandbox order</h1><p>Do not fulfill this order.</p>',
    dedupeKey: crypto.randomUUID(),
    ...overrides,
  };
  const { id, statement } = prepareEmailOutboxInsert(f.db, payload);
  await statement.run();
  return { id, payload, message: { outboxId: id } };
}

function row(id: string) {
  return f.sqlite.prepare('SELECT * FROM email_outbox WHERE id = ?').get(id);
}

function providerPayload() {
  const [, init] = fetchMock.mock.calls.at(-1) ?? [];
  if (typeof init?.body !== 'string') throw new Error('Expected a JSON Resend request body');
  return JSON.parse(init.body) as {
    from: string;
    to: string[];
    subject: string;
    html: string;
    cc?: string[];
    bcc?: string[];
  };
}

function makeDue(id: string) {
  f.sqlite.prepare("UPDATE email_outbox SET next_attempt_at = datetime('now', '-1 second') WHERE id = ?").run(id);
}

beforeEach(() => {
  f = fixture();
  fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ id: 'sandbox-provider-message-id' }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  // Queue processing must never fall back to a prior request's production env.
  vi.stubEnv('RESEND_API_KEY', 'unrelated-global-production-key');
  vi.stubEnv('FROM_EMAIL', 'orders@amammajaadi.com');
  vi.stubEnv('SQUARE_ENVIRONMENT', 'production');
  vi.stubEnv('SANDBOX_EMAIL_RECIPIENT', 'unrelated@example.com');
});

afterEach(() => {
  f.sqlite.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('sandbox-only email recipient isolation', () => {
  it.each([RECIPIENT, ' RAMCHARAN8600@GMAIL.COM '])('sends only the canonical approved recipient for %s', async (address) => {
    const email = await addEmail({ to: address });
    await expect(processEmailOutboxMessage(f.db, email.message, sandbox)).resolves.toEqual({ action: 'ack', status: 'sent' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.resend.com/emails');
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer fake-sandbox-sending-key' }));
    expect(providerPayload()).toEqual({
      from: 'Amamma Jaadi <sandbox@amammajaadi.com>',
      to: [RECIPIENT],
      subject: '[SANDBOX] Order Confirmation - AJ-TEST',
      html: email.payload.html,
    });
    expect(row(email.id)).toMatchObject({
      status: 'sent', attempts: 1, provider_message_id: 'sandbox-provider-message-id',
      last_error: null, next_attempt_at: null, lease_until: null,
    });
    expect(row(email.id)?.sent_at).toEqual(expect.any(String));
  });

  it('normalizes the configured allowed mailbox without expanding it to aliases', async () => {
    const email = await addEmail();
    await processEmailOutboxMessage(f.db, email.message, { ...sandbox, sandboxRecipient: ' RAMCHARAN8600@GMAIL.COM ' });
    expect(providerPayload().to).toEqual([RECIPIENT]);
  });

  it.each([
    ['old fixture recipient', ['audit-20260908@example.com']],
    ['foreign recipient', ['customer@example.com']],
    ['mixed recipients', [RECIPIENT, 'customer@example.com']],
    ['duplicate recipients', [RECIPIENT, RECIPIENT]],
    ['plus alias', ['ramcharan8600+test@gmail.com']],
    ['lookalike domain', ['ramcharan8600@gmail.com.evil.example']],
    ['display name', [`Test Customer <${RECIPIENT}>`]],
    ['comma separated addresses', [`${RECIPIENT},customer@example.com`]],
    ['header injection', [`${RECIPIENT}\r\nBcc: customer@example.com`]],
    ['empty recipient', ['']],
    ['empty list', []],
  ])('blocks %s without contacting Resend', async (_label, to) => {
    const email = await addEmail({ to });
    await expect(processEmailOutboxMessage(f.db, email.message, sandbox)).resolves.toEqual({ action: 'ack', status: 'failed' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(row(email.id)).toMatchObject({ status: 'failed', last_error: expect.stringContaining('SANDBOX_EMAIL_RECIPIENT_BLOCKED') });
    // Existing fixtures are not rewritten or redirected into the approved inbox.
    expect(row(email.id)?.to_json).toBe(JSON.stringify(to));
    expect(row(email.id)?.html).toBe(email.payload.html);
  });

  it.each(['cc', 'bcc'] as const)('blocks any nonempty %s, even the approved mailbox', async (field) => {
    const email = await addEmail({ [field]: [RECIPIENT] });
    await expect(processEmailOutboxMessage(f.db, email.message, sandbox)).resolves.toEqual({ action: 'ack', status: 'failed' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(row(email.id)?.last_error).toContain('SANDBOX_EMAIL_RECIPIENT_BLOCKED');
  });

  it.each(['to_json', 'cc_json', 'bcc_json'] as const)('fails closed for malformed %s rather than dropping it', async (field) => {
    const email = await addEmail();
    // The field name comes only from this fixed test list, not user data.
    f.sqlite.prepare(`UPDATE email_outbox SET ${field} = ? WHERE id = ?`).run('{"forged":"customer@example.com"}', email.id);
    await expect(processEmailOutboxMessage(f.db, email.message, sandbox)).resolves.toEqual({ action: 'ack', status: 'failed' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(row(email.id)?.last_error).toContain('SANDBOX_EMAIL_RECIPIENT_BLOCKED');
  });

  it.each(['not-json', 'null', JSON.stringify(RECIPIENT), '[123]', '[null]'])('blocks invalid original recipient serialization %s', async (rawTo) => {
    const email = await addEmail();
    f.sqlite.prepare('UPDATE email_outbox SET to_json = ? WHERE id = ?').run(rawTo, email.id);
    await expect(processEmailOutboxMessage(f.db, email.message, sandbox)).resolves.toEqual({ action: 'ack', status: 'failed' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(row(email.id)?.last_error).toContain('SANDBOX_EMAIL_RECIPIENT_BLOCKED');
  });

  it('allows explicit empty CC/BCC arrays without including them in the send', async () => {
    const email = await addEmail();
    f.sqlite.prepare('UPDATE email_outbox SET cc_json = ?, bcc_json = ? WHERE id = ?').run('[]', '[]', email.id);
    await processEmailOutboxMessage(f.db, email.message, sandbox);
    expect(providerPayload()).not.toHaveProperty('cc');
    expect(providerPayload()).not.toHaveProperty('bcc');
  });
});

describe('explicit delivery configuration, with no global credential fallback', () => {
  it.each([undefined, '', ' ', '*', 'not-an-email', 'Name <ramcharan8600@gmail.com>', 'one@example.com,two@example.com'])('retains sandbox mail when the allowed recipient setting is %s', async (sandboxRecipient) => {
    const email = await addEmail();
    await expect(processEmailOutboxMessage(f.db, email.message, { ...sandbox, sandboxRecipient })).resolves.toEqual({ action: 'retry', delaySeconds: 3_600 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(row(email.id)).toMatchObject({ status: 'retry', last_error: expect.stringContaining('SANDBOX_EMAIL_DELIVERY_NOT_CONFIGURED') });
    expect(row(email.id)?.next_attempt_at).toEqual(expect.any(String));
  });

  it.each([undefined, '', 'preview', 'PRODUCTION', 'prod'])('does not permit unrestricted recipients for environment %s', async (environment) => {
    const email = await addEmail({ to: 'customer@example.com' });
    await expect(processEmailOutboxMessage(f.db, email.message, { ...sandbox, environment, sandboxRecipient: undefined })).resolves.toEqual({ action: 'retry', delaySeconds: 3_600 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(row(email.id)?.last_error).toContain('SANDBOX_EMAIL_DELIVERY_NOT_CONFIGURED');
  });

  it('uses a restrictive recipient setting even if the environment is production', async () => {
    const email = await addEmail({ to: 'customer@example.com' });
    await expect(processEmailOutboxMessage(f.db, email.message, { ...sandbox, environment: 'production' })).resolves.toEqual({ action: 'ack', status: 'failed' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not recover missing delivery settings from process.env', async () => {
    const email = await addEmail();
    await expect(processEmailOutboxMessage(f.db, email.message, {})).resolves.toEqual({ action: 'retry', delaySeconds: 3_600 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(row(email.id)?.last_error).toContain('SANDBOX_EMAIL_DELIVERY_NOT_CONFIGURED');
  });

  it('keeps the sandbox restriction and label for an unknown environment with an explicit valid gate', async () => {
    const email = await addEmail();
    await expect(processEmailOutboxMessage(f.db, email.message, { ...sandbox, environment: 'preview' })).resolves.toEqual({ action: 'ack', status: 'sent' });
    expect(providerPayload().to).toEqual([RECIPIENT]);
    expect(providerPayload().subject).toMatch(/^\[SANDBOX\] /);
  });

  it.each([undefined, ''])('retains an allowed email when its explicit API key is %s', async (apiKey) => {
    const email = await addEmail();
    await expect(processEmailOutboxMessage(f.db, email.message, { ...sandbox, apiKey })).resolves.toEqual({ action: 'retry', delaySeconds: 3_600 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(row(email.id)).toMatchObject({ status: 'retry', last_error: expect.stringContaining('RESEND_API_KEY') });
  });

  it('preserves production recipients, CC/BCC, subject, and sender when unrestricted production is explicitly selected', async () => {
    const email = await addEmail({ to: ['customer@example.com', 'second@example.com'], cc: ['business@example.com'], bcc: ['audit@example.com'] });
    const settings: EmailDeliverySettings = { environment: 'production', apiKey: 'fake-explicit-production-key', fromEmail: 'orders@amammajaadi.com' };
    await expect(processEmailOutboxMessage(f.db, email.message, settings)).resolves.toEqual({ action: 'ack', status: 'sent' });
    expect(providerPayload()).toEqual({
      from: 'Amamma Jaadi <orders@amammajaadi.com>',
      to: email.payload.to, cc: email.payload.cc, bcc: email.payload.bcc,
      subject: email.payload.subject, html: email.payload.html,
    });
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer fake-explicit-production-key' }));
  });
});

describe('sandbox outbox durability and duplicate handling', () => {
  it('leases an in-flight email so concurrent Queue deliveries do not send twice', async () => {
    const email = await addEmail();
    let resolveProvider: ((response: Response) => void) | undefined;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveProvider = resolve; }));
    const first = processEmailOutboxMessage(f.db, email.message, sandbox);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(row(email.id)).toMatchObject({ status: 'sending', attempts: 1 });
    await expect(processEmailOutboxMessage(f.db, email.message, sandbox)).resolves.toMatchObject({ action: 'retry' });
    expect(fetchMock).toHaveBeenCalledOnce();
    if (!resolveProvider) throw new Error('Provider request was not started');
    resolveProvider(new Response(JSON.stringify({ id: 'concurrent-provider-id' }), { status: 200 }));
    await expect(first).resolves.toEqual({ action: 'ack', status: 'sent' });
    await expect(processEmailOutboxMessage(f.db, email.message, sandbox)).resolves.toEqual({ action: 'ack', status: 'already_handled' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(row(email.id)).toMatchObject({ status: 'sent', attempts: 1, provider_message_id: 'concurrent-provider-id' });
  });

  it('acknowledges an already-sent message without sending a second email', async () => {
    const email = await addEmail();
    await processEmailOutboxMessage(f.db, email.message, sandbox);
    await expect(processEmailOutboxMessage(f.db, email.message, sandbox)).resolves.toEqual({ action: 'ack', status: 'already_handled' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(row(email.id)?.attempts).toBe(1);
  });

  it('acknowledges blocked backlog retries without redirecting or sending them', async () => {
    const email = await addEmail({ to: 'audit-20260908@example.com' });
    await processEmailOutboxMessage(f.db, email.message, sandbox);
    await expect(processEmailOutboxMessage(f.db, email.message, sandbox)).resolves.toEqual({ action: 'ack', status: 'already_handled' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(row(email.id)?.attempts).toBe(1);
  });

  it('retains a daily quota failure and sends once after an explicit due-time retry', async () => {
    const email = await addEmail();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ name: 'daily_quota_exceeded' }), { status: 429 }));
    await expect(processEmailOutboxMessage(f.db, email.message, sandbox)).resolves.toEqual({ action: 'retry', delaySeconds: 3_600 });
    expect(row(email.id)).toMatchObject({ status: 'retry', attempts: 1, provider_message_id: null, sent_at: null });
    expect(row(email.id)?.last_error).toContain('daily_quota_exceeded');
    await expect(processEmailOutboxMessage(f.db, email.message, sandbox)).resolves.toMatchObject({ action: 'retry' });
    expect(fetchMock).toHaveBeenCalledOnce();
    makeDue(email.id);
    await expect(processEmailOutboxMessage(f.db, email.message, sandbox)).resolves.toEqual({ action: 'ack', status: 'sent' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(row(email.id)).toMatchObject({ status: 'sent', attempts: 2, provider_message_id: 'sandbox-provider-message-id', last_error: null, next_attempt_at: null });
    await processEmailOutboxMessage(f.db, email.message, sandbox);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps a missing-key email durable and resumes only when the explicit sandbox key is supplied', async () => {
    const email = await addEmail();
    await processEmailOutboxMessage(f.db, email.message, { ...sandbox, apiKey: undefined });
    expect(fetchMock).not.toHaveBeenCalled();
    makeDue(email.id);
    await expect(processEmailOutboxMessage(f.db, email.message, sandbox)).resolves.toEqual({ action: 'ack', status: 'sent' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(row(email.id)?.attempts).toBe(2);
  });

  it('retains network failures and clears the error after a successful retry', async () => {
    const email = await addEmail();
    fetchMock.mockRejectedValueOnce(new Error('Network connection lost'));
    await expect(processEmailOutboxMessage(f.db, email.message, sandbox)).resolves.toEqual({ action: 'retry', delaySeconds: 30 });
    expect(row(email.id)).toMatchObject({ status: 'retry', last_error: 'Network connection lost' });
    makeDue(email.id);
    await expect(processEmailOutboxMessage(f.db, email.message, sandbox)).resolves.toEqual({ action: 'ack', status: 'sent' });
    expect(row(email.id)?.last_error).toBeNull();
  });

  it('retains a permanent provider rejection as failed without retrying the send', async () => {
    const email = await addEmail();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ name: 'validation_error' }), { status: 422 }));
    await expect(processEmailOutboxMessage(f.db, email.message, sandbox)).resolves.toEqual({ action: 'ack', status: 'failed' });
    expect(row(email.id)).toMatchObject({ status: 'failed', provider_message_id: null, sent_at: null });
    await processEmailOutboxMessage(f.db, email.message, sandbox);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
