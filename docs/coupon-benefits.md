# Coupon benefits

On **Admin → Coupons → New Coupon**, choose either:

- **Complimentary pieces**: select Malai Khaja or Malpuri and 1–10 pieces.
- **Free delivery**: enter the minimum merchandise subtotal in dollars, before tax and delivery. Enter `0` for no coupon-specific minimum. Existing destination restrictions and shipping minimums still apply.

Free-delivery minimums can also be edited in the **Minimum cart value** column on the coupon's row; click **Save**. Edits and disabling affect new payment sessions. Sessions already quoted retain their promised benefit, including the amount charged and complimentary items.

Checkout validates the code against the database and recomputes the merchandise subtotal from catalog prices. Free delivery removes the shipping charge before calculating tax. It adds no complimentary products. Complimentary coupons continue adding zero-cost items to orders and confirmations and do not waive shipping. A free-delivery code is not used on pickup orders.

## Rollout

Apply `src/lib/migrations/016-coupon-benefits.sql` to the target D1 database **before** deploying this code. It adds the coupon type, minimum subtotal, and a payment-session benefit snapshot. Existing coupons retain their complimentary items, quantities, usage counts, and active status. The full `d1-schema.sql` also includes these fields for fresh databases.

Run the migration once per existing database; it uses `ALTER TABLE ADD COLUMN`. No live migration or deployment is performed by adding this file.
