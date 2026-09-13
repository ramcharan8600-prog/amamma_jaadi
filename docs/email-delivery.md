# Email delivery policy

Approved by the owner on September 12, 2026 (Dallas time).

## Order confirmations

- Order-confirmation outbox records (`order-confirmation:` business keys) always use Cloudflare Email Service, regardless of the legacy/general `EMAIL_PROVIDER` value. They never call Resend or fall back to it.
- Production sender: `Amamma Jaadi <orders@amammajaadi.com>`; the production binding permits only that sender.
- Every new confirmation BCCs `amamma.jaadi@gmail.com` and `ramcharan8600@gmail.com`. Both are verified Cloudflare destination addresses.
- Use the existing approved HTML renderer; do not fetch remote templates during checkout.
- The successful Square payment/order-finalization flow is unchanged. It atomically persists the order and confirmation outbox entry, then the Queue sends the email asynchronously.
- Temporary failures retain the original recipient, HTML, and BCCs in D1 and retry. Cloudflare daily-limit failures retry hourly. Permanent rejections remain inspectable as failed records. Already-sent records are not resent by normal Queue retries.
- Changing provider does not reset old sent/failed records or email previous customers again.

## Tracking and other existing email functions

- Keep the Resend account, verified sender/domain, and credentials intact for owner-commanded shipment/tracking email updates.
- Other preexisting outbox email types retain the configured provider (Resend in production). `EMAIL_PROVIDER=resend` is for those types, not confirmations.
- No label polling, scheduled tracking campaign, or new automatic tracking send is introduced. Send customer tracking updates only when the owner supplies/approves the shipment information and asks for the send.

## Sandbox and release checks

- Sandbox sender remains `sandbox@amammajaadi.com` with a `[SANDBOX]` subject prefix.
- Only `ramcharan8600@gmail.com` and the explicitly approved additional customer `sairamcharan20@gmail.com` may be primary test recipients; hidden copies are limited to the two approved BCC addresses. Production does not inherit these test gates.
- The sandbox and production D1 databases and queues remain separate.
- Before a release, run tests, lint, TypeScript, full build, and Wrangler dry-run. Verify production binding sender, no accidental sandbox restriction, and queue consumer/dead-letter settings after deployment.
- A production email smoke test must be clearly marked as a test, go only to owner-approved test inboxes, and must not create a real order or charge a real card.

## References

- [Cloudflare send bindings](https://developers.cloudflare.com/email-service/configuration/send-bindings/)
- [Cloudflare verified-destination quota exemption](https://developers.cloudflare.com/email-service/platform/limits/#verified-destination-addresses)
