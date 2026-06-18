# Amamma Jaadi — Production Ecommerce Platform

Premium South Indian sweets & pickles. Next.js 15 · TypeScript · Supabase · Square · Upstash Redis · Resend

## Quick Start

```bash
tar xzf amamma-jaadi.tar.gz && cd amamma-jaadi
npm install
cp .env.example .env.local  # fill in your keys
npm run dev
```

## Admin

- **Login:** `/admin/login` → `admin` / `REDACTED`
- **Analytics:** Requires PIN `REDACTED` (server-verified)
- **Session:** HMAC-SHA256 signed, 8-hour expiry, httpOnly cookies

## Architecture

```
src/
├── middleware.ts              # HMAC session verification + security headers
├── lib/
│   ├── session.ts             # Crypto session tokens (Issue 1+2)
│   ├── supabase.ts            # Database client (lazy init)
│   ├── product-service.ts     # Cache → Supabase → fallback (Issue 3)
│   ├── cache.ts               # Upstash Redis / in-memory cache (Issue 4)
│   ├── square.ts              # Payment integration architecture
│   ├── email-service.ts       # Resend transactional emails (Issue 6)
│   ├── seo.ts                 # Metadata + JSON-LD
│   └── utils.ts               # Business rules + formatters
├── app/api/
│   ├── auth/                  # Login/logout/verify (HMAC tokens)
│   ├── auth/verify-pin/       # Server-side PIN verification
│   ├── orders/                # Validated order persistence (Issue 5)
│   ├── events/                # Validated event inquiries
│   └── payments/              # Square payment architecture
```

## Security

| Layer | Implementation |
|---|---|
| Session tokens | `crypto.randomBytes(32)` + HMAC-SHA256 signature |
| Cookie validation | Signature + expiry verified in middleware (not just existence) |
| Timing attacks | `crypto.timingSafeEqual` for all comparisons |
| Login brute-force | Constant-time delay on failed attempts |
| Input sanitization | All API inputs validated + sanitized |
| Admin routes | Middleware blocks invalid/expired sessions |
| Security headers | X-Frame-Options, X-Content-Type-Options, Referrer-Policy |
| Secrets | Server-side only, never in client bundles |

## Services

| Service | Purpose | Required? |
|---|---|---|
| **Supabase** | Database (orders, products, events) | Yes |
| **Square** | Payments (card, Apple Pay, Google Pay) | When ready |
| **Upstash Redis** | Cache layer (products, rate limiting) | Optional (in-memory fallback) |
| **Resend** | Transactional emails | Optional (stubbed) |

## Environment Variables

See `.env.example` for all required and optional variables.

Critical: `SESSION_SECRET` — generate a random 64-character string for production.

## Database

Run `src/lib/supabase-schema.sql` in your Supabase SQL Editor.

## Business Rules

- **Large orders (>150 pcs):** 1-day minimum notice
- **Event orders:** 100pc minimum, 1–2 day notice
- **Pickup hours:** 6:30 PM – 1:30 AM
