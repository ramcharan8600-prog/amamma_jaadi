# Coupon benefits

On **Admin → Coupons → New Coupon**, choose either:

- **Complimentary pieces**: select Malai Khaja or Malpuri and 1–10 pieces.
- **Shipping offer — free in Texas**: enter the minimum merchandise subtotal in dollars, before tax and shipping. Enter `0` for no coupon-specific minimum. Existing destination restrictions and shipping minimums still apply.

Shipping-offer minimums can also be edited in the **Minimum cart value** column on the coupon's row; click **Save**. The value is configurable, not fixed at $70. An exact match qualifies. Below it, checkout says the coupon requires that minimum cart value. Edits and disabling affect new payment sessions. Sessions already quoted retain their promised benefit, including the amount charged and complimentary items.

Once the minimum is met, delivery in Texas is free. Pickle-only carts ship for $3.99 to every other supported state. Other carts receive $4 off shipping to AL, AR, CO, LA, NM, and OK, or $3 off shipping to remaining supported states. Far-state sweets and mixed carts still require an $80 product subtotal. Alaska and Hawaii still require a manual quote.

Without the coupon, pickle shipping remains $6.99 for one jar, $5.99 for two, and $4.99 for three or more. Eligible pickle-only checkout shows the $6.99 base shipping rate crossed out, explicitly labels it as the base rate before jar-count savings, and lists jar-count savings separately from actual coupon savings. For four jars outside Texas this means $2 in jar-count savings plus $1 in coupon savings, leaving $3.99 shipping. Other carts show their actual regular shipping rate crossed out.

Checkout validates the code against the database and recomputes the merchandise subtotal from catalog prices. Shipping savings are applied before calculating tax. Shipping offers add no complimentary products. Complimentary coupons continue adding zero-cost items to orders and confirmations and do not discount shipping. Shipping offers are not used on pickup orders.

New quotes store `shippingPolicy: regional_v1` in the existing coupon snapshot. Older snapshots without a policy retain their previously promised free delivery in every state, including during first-charge validation. Changing this policy does not require another database migration.

## Rollout

Apply `src/lib/migrations/016-coupon-benefits.sql` to the target D1 database **before** deploying this code. It adds the coupon type, minimum subtotal, and a payment-session benefit snapshot. Existing coupons retain their complimentary items, quantities, usage counts, and active status. The full `d1-schema.sql` also includes these fields for fresh databases.

Run the migration once per existing database; it uses `ALTER TABLE ADD COLUMN`. No live migration or deployment is performed by adding this file.
