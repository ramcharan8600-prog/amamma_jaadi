# Approved Amamma Jaadi email template

Approved by the owner on September 12, 2026 (America/Chicago), after receipt of sandbox preview AJ-1031.

## Source and saved preview

- The reusable renderer remains in `src/lib/email-service.ts`: `baseTemplate` supplies the branding and `buildOrderConfirmationEmail` fills each order's details.
- `order-confirmation-approved-preview.html` is the exact rendered HTML saved from the successfully sent AJ-1031 sandbox email. It contains sample test-order details and is a visual reference, not a template to send unchanged to customers.
- The approved renderer is already deployed in the sandbox Worker.

## Approved header

- Circular logo: 57.2 × 57.2 CSS pixels (57 × 57 HTML fallback), enlarged by 10%.
- Brand name: 26.4px, bold, #7B1F1F.
- Tagline: FLAVORS OF HOME, 13.2px, #C6992E, 2.2px letter spacing.
- Header divider: 2px solid deep maroon #5C1626.
- Existing body content, item table, order details, and footer preserved.

## Verification and rollout

- Preview AJ-1031 was sent through Cloudflare Email Service on the first attempt; the owner approved its appearance.
- Sandbox sender: sandbox@amammajaadi.com; approved test customers: ramcharan8600@gmail.com and sairamcharan20@gmail.com.
- Every new order confirmation includes hidden copies to amamma.jaadi@gmail.com and ramcharan8600@gmail.com, defined in `src/lib/email-recipients.ts`. The removed optional `ORDER_CONFIRMATION_BCC_EMAIL` setting no longer controls these copies.
- The sandbox Queue consumer and the Cloudflare email binding both restrict recipients; unknown customer addresses and unapproved copies remain blocked. Existing sent/failed outbox rows are not rewritten or resent.
- Existing D1 outbox and Queue continue to send asynchronously.
- The visual template was approved first in sandbox. The owner subsequently authorized switching production order confirmations to Cloudflare Email Service, using orders@amammajaadi.com.
- See `../email-delivery.md` for the confirmation-only provider policy, retained Resend tracking path, and release checks.
