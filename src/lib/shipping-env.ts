import { getCloudflareContext } from '@opennextjs/cloudflare';

/** Runtime vars and secrets: the Worker env (request scope) over Node's process.env. */
function runtimeEnv(): Record<string, string | undefined> {
  let cf: Record<string, string | undefined> = {};
  try {
    cf = getCloudflareContext().env as unknown as Record<string, string | undefined>;
  } catch {
    // Outside a request (build, tests): process.env only.
  }
  return { ...(process.env as Record<string, string | undefined>), ...cf };
}

/** Shippo secret (sandbox: test key; production: live key). Never logged or sent to the browser. */
export function shippoApiKey(env: Record<string, string | undefined> = runtimeEnv()): string {
  return env.SHIPPO_API_KEY ?? '';
}

/**
 * Inbox for label emails and the nightly waiting list: the shop's Gmail in
 * production; in sandbox the test inbox (the sandbox email gate only allows it).
 */
export function shopShippingEmail(env: Record<string, string | undefined> = runtimeEnv()): string | null {
  if (env.SQUARE_ENVIRONMENT === 'production' && !env.SANDBOX_EMAIL_RECIPIENT) return 'amamma.jaadi@gmail.com';
  return env.SANDBOX_EMAIL_RECIPIENT?.trim() || null;
}

/** The shop is copied (Cc) on customer tracking emails in production only; the sandbox email gate allows no Cc. */
export function trackingEmailCc(env: Record<string, string | undefined> = runtimeEnv()): string[] {
  return env.SQUARE_ENVIRONMENT === 'production' && !env.SANDBOX_EMAIL_RECIPIENT ? ['amamma.jaadi@gmail.com'] : [];
}

/** Customer tracking emails are switched on per environment (production starts off until approved). */
export function customerTrackingEmailsOn(env: Record<string, string | undefined> = runtimeEnv()): boolean {
  return env.CUSTOMER_TRACKING_EMAILS === 'on';
}
