import Image from 'next/image';

/**
 * The whole storefront while SHOP_CLOSED is on (see src/lib/constants.ts).
 *
 * Deliberately plain and honest: it says the shop is not taking orders, it does
 * not promise a date, and it tells customers who already paid that their order
 * is still coming. Nothing here can start an order. The admin portal is not
 * affected — /admin keeps working so orders in hand can still be fulfilled.
 */
export default function ShopClosed() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-cream px-6 py-16">
      <div className="w-full max-w-lg text-center space-y-7">
        <Image
          src="/images/web/logo-192.webp"
          alt="Amamma Jaadi"
          width={160}
          height={160}
          priority
          className="w-[120px] h-[120px] object-contain mx-auto"
        />

        <div className="space-y-2">
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-brand-maroon">
            Amamma Jaadi
          </h1>
          <p className="font-display text-base tracking-[0.2em] text-brand-charcoal/50 uppercase">
            Flavors of Home
          </p>
        </div>

        <div className="card p-7 space-y-4 text-left">
          <h2 className="font-display text-xl font-bold text-brand-charcoal text-center">
            We are not taking orders right now
          </h2>
          <p className="font-body text-sm leading-relaxed text-brand-charcoal/70">
            Our online shop is closed for the moment. We are sorry for the
            inconvenience, and we are grateful for every one of you who has
            ordered from us.
          </p>
          <p className="font-body text-sm leading-relaxed text-brand-charcoal/70">
            <strong className="text-brand-charcoal">
              If you have already placed an order, it will be honoured.
            </strong>{' '}
            Your sweets and pickles are still coming, and you will get your
            tracking details by email as usual. If you need anything about an
            order you have already paid for, simply reply to your order
            confirmation email and we will take care of it.
          </p>
        </div>

        <p className="font-body text-xs text-brand-charcoal/40">
          © {new Date().getFullYear()} Amamma Jaadi · Dallas, USA
        </p>
      </div>
    </div>
  );
}
