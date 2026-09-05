import { getCloudflareContext } from '@opennextjs/cloudflare';
import type { D1Database, Queue } from '@cloudflare/workers-types';

export interface EmailQueueMessage {
  outboxId: string;
}

export interface EmailWorkerEnv {
  DB: D1Database;
  EMAIL_QUEUE: Queue<EmailQueueMessage>;
}

export interface EmailOutboxPayload {
  to: string | string[];
  subject: string;
  html: string;
  cc?: string[];
  bcc?: string[];
  dedupeKey: string;
}

interface EmailOutboxRow {
  id: string;
  status: 'pending' | 'sending' | 'retry' | 'sent' | 'failed';
  to_json: string;
  cc_json: string | null;
  bcc_json: string | null;
  subject: string;
  html: string;
  attempts: number;
  next_attempt_at: string | null;
}

export type EmailQueueOutcome =
  | { action: 'ack'; status: 'sent' | 'failed' | 'already_handled' | 'missing' }
  | { action: 'retry'; delaySeconds: number };

const DEFAULT_FROM_EMAIL = 'orders@amammajaadi.com';
const MAX_RETRY_DELAY_SECONDS = 60 * 60;

/** Email can be accepted whenever the durable outbox infrastructure exists. */
export function isEmailOutboxConfigured(): boolean {
  try {
    const env = getCloudflareContext().env as CloudflareEnv & Partial<EmailWorkerEnv>;
    return Boolean(env.DB && env.EMAIL_QUEUE);
  } catch {
    return false;
  }
}

function asArray(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

function parseAddressList(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : [];
  } catch {
    return [];
  }
}

function errorText(value: unknown): string {
  if (value instanceof Error) return value.message.slice(0, 2_000);
  return String(value ?? 'Unknown email error').slice(0, 2_000);
}

function secondsUntil(value: string | null): number {
  if (!value) return 60;
  const due = Date.parse(value.replace(' ', 'T') + (value.endsWith('Z') ? '' : 'Z'));
  if (!Number.isFinite(due)) return 60;
  return Math.max(60, Math.min(86_400, Math.ceil((due - Date.now()) / 1_000)));
}

export function isEmailQueueMessage(value: unknown): value is EmailQueueMessage {
  if (!value || typeof value !== 'object') return false;
  const id = (value as { outboxId?: unknown }).outboxId;
  return (
    typeof id === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
  );
}

export function calculateEmailRetryDelay(
  attempts: number,
  httpStatus?: number,
  providerError?: string,
  retryAfterHeader?: string | null
): number {
  if (retryAfterHeader) {
    const headerSeconds = Number(retryAfterHeader);
    if (Number.isFinite(headerSeconds) && headerSeconds > 0) {
      return Math.max(1, Math.min(86_400, Math.ceil(headerSeconds)));
    }
  }

  // Resend's free-plan quota is a rolling daily window. Retry hourly while D1
  // keeps the message durable; the scheduled recovery job is the final safety net.
  if (httpStatus === 429 && providerError?.includes('daily_quota_exceeded')) {
    return MAX_RETRY_DELAY_SECONDS;
  }

  if (httpStatus === 429) return 60;
  return Math.min(MAX_RETRY_DELAY_SECONDS, 30 * 2 ** Math.max(0, attempts - 1));
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

/**
 * Persist an email before publishing its small, non-sensitive outbox id to the
 * Queue. A failed Queue publish does not lose the email: the scheduled recovery
 * handler republishes pending D1 rows.
 */
export async function enqueueEmail(
  params: EmailOutboxPayload
): Promise<{ success: boolean; id?: string; queued?: boolean }> {
  let env: CloudflareEnv & Partial<EmailWorkerEnv>;
  try {
    env = getCloudflareContext().env as CloudflareEnv & Partial<EmailWorkerEnv>;
  } catch (error) {
    console.error(JSON.stringify({ event: 'email_outbox_context_failed', error: errorText(error) }));
    return { success: false };
  }

  if (!env.DB) {
    console.error(JSON.stringify({ event: 'email_outbox_db_missing' }));
    return { success: false };
  }

  const id = crypto.randomUUID();
  const to = asArray(params.to);

  try {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO email_outbox
        (id, dedupe_key, to_json, cc_json, bcc_json, subject, html, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`
    )
      .bind(
        id,
        params.dedupeKey,
        JSON.stringify(to),
        params.cc?.length ? JSON.stringify(params.cc) : null,
        params.bcc?.length ? JSON.stringify(params.bcc) : null,
        params.subject,
        params.html
      )
      .run();

    const row = await env.DB.prepare(
      'SELECT id, status FROM email_outbox WHERE dedupe_key = ? LIMIT 1'
    )
      .bind(params.dedupeKey)
      .first<{ id: string; status: EmailOutboxRow['status'] }>();

    if (!row) throw new Error('Email outbox row was not created');
    if (row.status === 'sent') return { success: true, id: row.id, queued: false };
    if (row.status === 'failed') return { success: false, id: row.id, queued: false };

    if (!env.EMAIL_QUEUE) {
      console.error(JSON.stringify({ event: 'email_queue_binding_missing', outboxId: row.id }));
      return { success: true, id: row.id, queued: false };
    }

    try {
      await env.EMAIL_QUEUE.send({ outboxId: row.id });
      await markEmailOutboxEnqueued(env.DB, row.id);
      return { success: true, id: row.id, queued: true };
    } catch (error) {
      console.error(
        JSON.stringify({ event: 'email_queue_publish_failed', outboxId: row.id, error: errorText(error) })
      );
      return { success: true, id: row.id, queued: false };
    }
  } catch (error) {
    console.error(JSON.stringify({ event: 'email_outbox_persist_failed', error: errorText(error) }));
    return { success: false };
  }
}

async function getOutboxState(
  db: D1Database,
  outboxId: string
): Promise<Pick<EmailOutboxRow, 'status' | 'next_attempt_at'> | null> {
  return db
    .prepare('SELECT status, next_attempt_at FROM email_outbox WHERE id = ? LIMIT 1')
    .bind(outboxId)
    .first<Pick<EmailOutboxRow, 'status' | 'next_attempt_at'>>();
}

async function claimOutboxRow(db: D1Database, outboxId: string): Promise<EmailOutboxRow | null> {
  return db
    .prepare(
      `UPDATE email_outbox
       SET status = 'sending', attempts = attempts + 1,
           lease_until = datetime('now', '+5 minutes'), updated_at = datetime('now')
       WHERE id = ? AND (
         (status IN ('pending', 'retry') AND (next_attempt_at IS NULL OR next_attempt_at <= datetime('now')))
         OR (status = 'sending' AND (lease_until IS NULL OR lease_until <= datetime('now')))
       )
       RETURNING id, status, to_json, cc_json, bcc_json, subject, html, attempts, next_attempt_at`
    )
    .bind(outboxId)
    .first<EmailOutboxRow>();
}

async function markRetry(
  db: D1Database,
  outboxId: string,
  delaySeconds: number,
  error: string
): Promise<void> {
  await db
    .prepare(
      `UPDATE email_outbox
       SET status = 'retry', last_error = ?, lease_until = NULL,
           next_attempt_at = datetime('now', ?), updated_at = datetime('now')
       WHERE id = ? AND status != 'sent'`
    )
    .bind(error.slice(0, 2_000), `+${Math.max(1, Math.ceil(delaySeconds))} seconds`, outboxId)
    .run();
}

async function markFailed(db: D1Database, outboxId: string, error: string): Promise<void> {
  await db
    .prepare(
      `UPDATE email_outbox
       SET status = 'failed', last_error = ?, lease_until = NULL,
           next_attempt_at = NULL, updated_at = datetime('now')
       WHERE id = ? AND status != 'sent'`
    )
    .bind(error.slice(0, 2_000), outboxId)
    .run();
}

export async function markEmailOutboxEnqueued(db: D1Database, outboxId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE email_outbox SET last_enqueued_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ? AND status != 'sent'`
    )
    .bind(outboxId)
    .run();
}

/** Process one D1-backed message. Called only by the custom Worker's Queue handler. */
export async function processEmailOutboxMessage(
  db: D1Database,
  message: EmailQueueMessage
): Promise<EmailQueueOutcome> {
  const claimed = await claimOutboxRow(db, message.outboxId);
  if (!claimed) {
    const current = await getOutboxState(db, message.outboxId);
    if (!current) return { action: 'ack', status: 'missing' };
    if (current.status === 'sent' || current.status === 'failed') {
      return { action: 'ack', status: 'already_handled' };
    }
    return { action: 'retry', delaySeconds: secondsUntil(current.next_attempt_at) };
  }

  const to = parseAddressList(claimed.to_json);
  const cc = parseAddressList(claimed.cc_json);
  const bcc = parseAddressList(claimed.bcc_json);
  if (to.length === 0) {
    await markFailed(db, claimed.id, 'Outbox email has no valid recipient list');
    return { action: 'ack', status: 'failed' };
  }

  const apiKey = process.env.RESEND_API_KEY || '';
  if (!apiKey) {
    const delaySeconds = MAX_RETRY_DELAY_SECONDS;
    await markRetry(db, claimed.id, delaySeconds, 'RESEND_API_KEY is not configured');
    return { action: 'retry', delaySeconds };
  }

  let response: Response;
  let responseBody = '';
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `Amamma Jaadi <${process.env.FROM_EMAIL || DEFAULT_FROM_EMAIL}>`,
        to,
        subject: claimed.subject,
        html: claimed.html,
        ...(cc.length ? { cc } : {}),
        ...(bcc.length ? { bcc } : {}),
      }),
    });
    // Resend errors are small JSON documents; cap what is retained in D1/logs.
    responseBody = (await response.text()).slice(0, 2_000);
  } catch (error) {
    const delaySeconds = calculateEmailRetryDelay(claimed.attempts);
    const detail = errorText(error);
    await markRetry(db, claimed.id, delaySeconds, detail);
    console.error(
      JSON.stringify({ event: 'email_delivery_retry', outboxId: claimed.id, attempts: claimed.attempts, detail })
    );
    return { action: 'retry', delaySeconds };
  }

  if (response.ok) {
    let providerMessageId: string | null = null;
    try {
      const parsed = JSON.parse(responseBody) as { id?: unknown };
      providerMessageId = typeof parsed.id === 'string' ? parsed.id : null;
    } catch {
      // A successful response without JSON is still a successful send.
    }
    await db
      .prepare(
        `UPDATE email_outbox
         SET status = 'sent', provider_message_id = ?, sent_at = datetime('now'),
             lease_until = NULL, next_attempt_at = NULL, last_error = NULL,
             updated_at = datetime('now')
         WHERE id = ?`
      )
      .bind(providerMessageId, claimed.id)
      .run();
    console.log(
      JSON.stringify({ event: 'email_delivery_sent', outboxId: claimed.id, attempts: claimed.attempts })
    );
    return { action: 'ack', status: 'sent' };
  }

  const detail = `Resend ${response.status}: ${responseBody || response.statusText}`.slice(0, 2_000);
  if (isRetryableStatus(response.status)) {
    const delaySeconds = calculateEmailRetryDelay(
      claimed.attempts,
      response.status,
      responseBody,
      response.headers.get('retry-after')
    );
    await markRetry(db, claimed.id, delaySeconds, detail);
    console.error(
      JSON.stringify({
        event: 'email_delivery_retry',
        outboxId: claimed.id,
        attempts: claimed.attempts,
        providerStatus: response.status,
        delaySeconds,
      })
    );
    return { action: 'retry', delaySeconds };
  }

  await markFailed(db, claimed.id, detail);
  console.error(
    JSON.stringify({
      event: 'email_delivery_failed',
      outboxId: claimed.id,
      attempts: claimed.attempts,
      providerStatus: response.status,
    })
  );
  return { action: 'ack', status: 'failed' };
}

/**
 * Cron safety net: republish due rows whose Queue message was never published,
 * expired, or exhausted its platform retries. D1 remains the source of truth.
 */
export async function recoverPendingEmailOutbox(
  db: D1Database,
  queue: Queue<EmailQueueMessage>
): Promise<number> {
  const result = await db
    .prepare(
      `SELECT id FROM email_outbox
       WHERE (
         (status IN ('pending', 'retry') AND (next_attempt_at IS NULL OR next_attempt_at <= datetime('now')))
         OR (status = 'sending' AND (lease_until IS NULL OR lease_until <= datetime('now')))
       )
       AND (last_enqueued_at IS NULL OR last_enqueued_at <= datetime('now', '-2 hours'))
       ORDER BY created_at ASC
       LIMIT 50`
    )
    .all<{ id: string }>();

  let published = 0;
  for (const row of result.results) {
    try {
      await queue.send({ outboxId: row.id });
      await markEmailOutboxEnqueued(db, row.id);
      published += 1;
    } catch (error) {
      console.error(
        JSON.stringify({ event: 'email_outbox_recovery_publish_failed', outboxId: row.id, error: errorText(error) })
      );
    }
  }
  return published;
}
