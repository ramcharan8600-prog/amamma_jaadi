# Coupon benefits

Admin → Coupons supports complimentary-only codes and shipping-offer codes. Codes accept letters and numbers and normalize to uppercase. Shipping-offer minimums are editable on the coupon row, in dollars before tax, shipping, and fees. Exact matches qualify; no minimum is hardcoded. Below the configured minimum, checkout rejects the coupon and explains the required cart value.

## Current shipping offer

- Texas delivery: free shipping once the minimum is met.
- Texas pickle-only delivery with this coupon: a separate $1.99 maintenance fee. The amount is shown separately in checkout, payment, and confirmation.
- Texas sweets-only and mixed carts: free shipping plus a separate $0.99 maintenance fee. All maintenance labels and charges stay hidden outside Texas, for pickup, and without an eligible shipping coupon.
- Outside Texas: regular shipping, no shipping discount or maintenance fee.
- This shipping offer adds no complimentary pieces in any state. Far-state sweets and mixed carts retain the existing $80 delivery minimum.
- Pickup: shipping offers are excluded; no maintenance fee. Complimentary-only coupons keep their existing behavior.

Regular pickle-only shipping is now flat $6.99 for any jar count in all supported states, with no ordinary delivery minimum. Sweets and mixed carts retain $6.99 in Texas; $11.99 below $60 or $8.99 at $60+ in nearby states (AL, AR, CO, LA, NM, OK); and $11.99 with an $80 minimum elsewhere. Mixed carts use the higher applicable rate, never the sum. Alaska and Hawaii still need a manual quote. Gift-box destination restrictions remain unchanged.

Checkout and the server share pricing logic. The server recomputes merchandise from catalog prices and ignores browser-supplied totals, fee amounts, cart classifications, and coupon benefits. New sessions persist `pricing_policy: texas_v3`, `shippingPolicy: texas_v3`, and the separately charged maintenance fee. Admin edits and deactivation affect new sessions; existing sessions retain their promised benefit. The initial sandbox `texas_v2` sweets/mixed quotes retain their zero fee. Old `regional_v1` and unversioned coupon snapshots and legacy regular pickle quotes retain their original pricing, without a maintenance fee.

The maintenance fee follows the existing Texas tax treatment for mandatory delivery-related charges on taxable pickle sales. Public receipts keep shipping and maintenance separate. The historical tax/refund ledger's `shipping_cents` remains the aggregate delivery-charge bucket so existing sum constraints and refund allocations reconcile. Its immutable JSON snapshot also records `maintenanceFeeCents` separately; report labels say shipping and fees. Reference: https://comptroller.texas.gov/taxes/sales/faq/collection.php

## Rollout

Migration 016 must already be applied. Apply `017-texas-coupon-maintenance.sql` before deploying this change. It adds zero-default maintenance-fee columns to sessions and orders, and a legacy-default session pricing policy. Existing rows and historical tax records are preserved. Apply each ALTER migration only once. The full schema includes these fields for new databases.

Validated in sandbox with 1,030 automated tests and 12 completed Square Sandbox orders, including a browser card checkout. Production rollout was authorized on September 23, 2026. Apply the maintenance-fee migration before deploying the application; preserve historical session policies during rollout.
