# Amamma Jaadi — Production Ecommerce Platform

Premium South Indian sweets & pickles. Next.js 15 · TypeScript · Cloudflare Workers (OpenNext) · Cloudflare D1 · Square · Resend

## Quick Start

```bash
tar xzf amamma-jaadi.tar.gz && cd amamma-jaadi
npm install
cp .env.example .env.local  # fill in your keys
npm run dev
```

Other scripts: `npm test` (Vitest), `npm run preview` (build + local Workers preview), `npm run deploy` (build + deploy to Cloudflare).

## Admin

- Login: `/admin/login` → credentials from `ADMIN_USERNAME` / `ADMIN_PASSWORD`
- Analytics: `/admin/analytics` → gated behind `ANALYTICS_PIN`

## Architecture

```
src/
├── middleware.ts              # HMAC session verification + security headers (CSP/HSTS)
├── lib/
│   ├── session.ts             # Crypto session tokens (HMAC-SHA256)
│   ├── crypto.ts              # Constant-time secret comparison
│   ├── db.ts                  # Cloudflare D1 access layer (DB binding)
│   ├── order-service.ts       # Single idempotent order-creation path
│   ├── square.ts              # Square Payments API integration
│   ├── email-service.ts       # Resend transactional emails
│   ├── rate-limit.ts          # In-memory sliding-window limiter
│   ├── sanitize.ts            # Input trimming / length caps
│   ├── date.ts                # Business-timezone date helpers
│   ├── seo.ts                 # Metadata + JSON-LD
│   ├── constants.ts           # Brand-wide constants
│   └── utils.ts               # Business rules + formatters
├── data/products.ts           # Product catalog (source of truth for pricing)
├── app/api/
│   ├── auth/                  # Login/logout/verify (HMAC tokens)
│   ├── auth/verify-pin/       # Server-side analytics PIN verification
│   ├── orders/                # Admin-only paid-order fetch
│   ├── events/                # Validated event inquiries
│   └── payments/              # create-session · create-payment · webhook · verify
```

## Security

| Layer | Implementation |
|---|---|
| Session tokens | `crypto.randomBytes(32)` + HMAC-SHA256 signature |
| Cookie validation | Signature + expiry verified in middleware (not just existence) |
| Timing attacks | `crypto.timingSafeEqual` for all secret comparisons |
| Login brute-force | Constant-time delay on failed attempts |
| Webhook authenticity | Square HMAC-SHA256 signature verified before any DB write |
| Input sanitization | All API inputs validated + sanitized; prices recomputed server-side |
| Admin routes | Middleware blocks invalid/expired sessions |
| Security headers | CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy |
| Secrets | Server-side only, never in client bundles |

## Services

| Service | Purpose | Required? |
|---|---|---|
| **Cloudflare D1** | Database (orders, order_items, payment_sessions, events) | Yes |
| **Square** | Payments (card, Apple Pay) | Yes |
| **Resend** | Transactional emails | Optional (stubbed until `RESEND_API_KEY` set) |

## Environment Variables

See `.env.example` for all required and optional variables. Non-secret runtime
config lives in `wrangler.jsonc` (`vars`); secrets are set as Cloudflare
dashboard Secrets. Critical: `SESSION_SECRET` — a random 64-character string.

## Database

Cloudflare D1 is bound to the Worker as `DB`. Apply the schema with:

```bash
wrangler d1 execute amammajaadi --remote --file=src/lib/d1-schema.sql
```

## Business Rules

- **Large orders (>150 pcs):** 1-day minimum notice
- **Event orders:** 100pc minimum, 2-day notice
- **Pickup hours:** 6:30 PM – 1:30 AM
