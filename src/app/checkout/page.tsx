'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Clock,
  MapPin,
  Truck,
  ArrowLeft,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Package,
  Trash2,
  Loader2,
} from 'lucide-react';
import { useCartStore } from '@/store/cart';
import { PICKUP_LOCATIONS, getPickupLocationById } from '@/data/products';
import {
  formatCurrency,
  getMinPickupDate,
  getTodayString,
} from '@/lib/utils';
import type {
  FulfillmentType,
  PickupDetails,
  DeliveryDetails,
  NormalizedAddress,
  AddressValidationResult,
} from '@/types';
import { isAddressValidationFailure } from '@/types';

export default function CheckoutPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const { items, getSubtotal, getTotalPieces, isLargeOrder, setFulfillment, clearCart, removeItem } =
    useCartStore();

  const [step, setStep] = useState<'fulfillment' | 'details' | 'confirm' | 'payment'>('fulfillment');
  const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType | null>(null);

  // Pickup state
  const [pickupDate, setPickupDate] = useState('');
  const [pickupLocationId, setPickupLocationId] = useState('');
  const [pickupName, setPickupName] = useState('');
  const [pickupPhone, setPickupPhone] = useState('');
  const [pickupEmail, setPickupEmail] = useState('');

  // Delivery state
  const [deliveryName, setDeliveryName] = useState('');
  const [deliveryPhone, setDeliveryPhone] = useState('');
  const [deliveryEmail, setDeliveryEmail] = useState('');
  const [deliveryAddressLine1, setDeliveryAddressLine1] = useState('');
  const [deliveryAddressLine2, setDeliveryAddressLine2] = useState('');
  const [deliveryCity, setDeliveryCity] = useState('');
  const [deliveryState, setDeliveryState] = useState('TX');
  const [deliveryZip, setDeliveryZip] = useState('');
  const [deliveryCountry, setDeliveryCountry] = useState('USA');

  // Address-validation state
  const [validatingAddress, setValidatingAddress] = useState(false);
  const [addressError, setAddressError] = useState('');
  const [addressSuggestion, setAddressSuggestion] = useState<NormalizedAddress | null>(null);
  const [validatedAddress, setValidatedAddress] = useState<NormalizedAddress | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [orderComplete, setOrderComplete] = useState(false);
  const [orderNumber, setOrderNumber] = useState('');

  // Square card-payment state
  const [sessionInfo, setSessionInfo] = useState<{
    sessionId: string;
    appId: string;
    locationId: string;
    total: number;
  } | null>(null);
  const [cardReady, setCardReady] = useState(false);
  const [paying, setPaying] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const squareCardRef = useRef<SquareCard | null>(null);

  useEffect(() => setMounted(true), []);

  // Load the Square Web Payments SDK and mount the card field on the payment step.
  useEffect(() => {
    if (step !== 'payment' || !sessionInfo) return;
    let cancelled = false;

    const env =
      process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
    const sdkUrl =
      env === 'production'
        ? 'https://web.squarecdn.com/v1/square.js'
        : 'https://sandbox.web.squarecdn.com/v1/square.js';

    const loadSdk = () =>
      new Promise<void>((resolve, reject) => {
        if (window.Square) return resolve();
        const existing = document.querySelector<HTMLScriptElement>(`script[src="${sdkUrl}"]`);
        if (existing) {
          existing.addEventListener('load', () => resolve());
          existing.addEventListener('error', () => reject(new Error('Square SDK failed to load')));
          return;
        }
        const script = document.createElement('script');
        script.src = sdkUrl;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Square SDK failed to load'));
        document.body.appendChild(script);
      });

    const init = async () => {
      try {
        await loadSdk();
        if (cancelled || !window.Square) return;
        const payments = window.Square.payments(sessionInfo.appId, sessionInfo.locationId);
        const card = await payments.card();
        if (cancelled) {
          await card.destroy().catch(() => {});
          return;
        }
        await card.attach('#square-card-container');
        squareCardRef.current = card;
        setCardReady(true);
      } catch (e) {
        console.error('Square init failed:', e);
        setPaymentError('We could not load the secure payment form. Please refresh and try again.');
      }
    };
    init();

    return () => {
      cancelled = true;
      setCardReady(false);
      const card = squareCardRef.current;
      squareCardRef.current = null;
      if (card) card.destroy().catch(() => {});
    };
  }, [step, sessionInfo]);

  const subtotal = useMemo(() => (mounted ? getSubtotal() : 0), [mounted, getSubtotal]);
  const totalPieces = useMemo(() => (mounted ? getTotalPieces() : 0), [mounted, getTotalPieces]);
  const largeOrder = useMemo(() => (mounted ? isLargeOrder() : false), [mounted, isLargeOrder]);
  const minPickupDate = useMemo(() => getMinPickupDate(totalPieces), [totalPieces]);
  const selectedLocation = useMemo(
    () => (pickupLocationId ? getPickupLocationById(pickupLocationId) : null),
    [pickupLocationId]
  );

  if (!mounted) {
    return (
      <div className="section-padding py-16 text-center">
        <p className="font-body text-brand-charcoal/60">Loading...</p>
      </div>
    );
  }

  if (items.length === 0 && !orderComplete) {
    return (
      <div className="section-padding py-24 text-center space-y-4">
        <Package size={48} className="mx-auto text-brand-charcoal/20" />
        <h1 className="font-display text-2xl font-bold text-brand-charcoal">
          No items to checkout
        </h1>
        <Link href="/" className="btn-primary inline-flex gap-2">
          <ArrowLeft size={16} /> Go to Shop
        </Link>
      </div>
    );
  }

  if (orderComplete) {
    return (
      <div className="section-padding py-24 text-center space-y-6 max-w-lg mx-auto">
        <CheckCircle2 size={64} className="mx-auto text-green-500" />
        <h1 className="font-display text-3xl font-bold text-brand-charcoal">
          {orderNumber ? 'Payment Confirmed!' : 'Order Submitted!'}
        </h1>
        {orderNumber ? (
          <p className="font-body text-brand-charcoal/70">
            Your order number is{' '}
            <span className="font-display font-bold text-brand-maroon">{orderNumber}</span>.
            A confirmation has been sent to your email.
          </p>
        ) : (
          <p className="font-body text-brand-charcoal/60">
            Thank you! Once your payment is confirmed, you&apos;ll receive an email
            with your order number and full details.
          </p>
        )}
        <Link href="/" className="btn-primary inline-flex gap-2">
          Continue Shopping
        </Link>
      </div>
    );
  }

  const handleSubmitOrder = async () => {
    setSubmitting(true);
    setSubmitError('');

    let fulfillment: PickupDetails | DeliveryDetails;

    if (fulfillmentType === 'pickup') {
      fulfillment = {
        type: 'pickup',
        date: pickupDate,
        locationId: pickupLocationId,
        customerName: pickupName,
        phone: pickupPhone,
        email: pickupEmail,
      };
    } else {
      // Use the Google-normalized address when available (it always should be,
      // since delivery cannot reach this step without passing validation).
      const n = validatedAddress;
      fulfillment = {
        type: 'delivery',
        customerName: deliveryName,
        phone: deliveryPhone,
        email: deliveryEmail,
        addressLine1: n?.addressLine1 ?? deliveryAddressLine1,
        addressLine2: n?.addressLine2 ?? deliveryAddressLine2,
        city: n?.city ?? deliveryCity,
        state: n?.state ?? deliveryState,
        zip: n?.zip ?? deliveryZip,
        country: 'USA',
        ...(n ? { normalized: n } : {}),
      };
    }

    setFulfillment(fulfillment);

    // Save fulfillment details to a payment session.
    // The actual order and order number are created by the Square webhook
    // once payment is verified — Square's payment ID becomes the order number.
    try {
      const res = await fetch('/api/payments/create-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items,
          fulfillment,
          customerName: fulfillment.customerName,
          email: fulfillment.email,
          phone: fulfillment.phone,
          tax: 0,
          // NOTE: `total` is sent for reference only.
          // The server recomputes the authoritative total from item prices.
          total: subtotal,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('Session creation failed:', err);
        // 422 = the server-side address gate rejected the delivery address.
        if (res.status === 422 && fulfillment.type === 'delivery') {
          setValidatedAddress(null);
          setAddressError(err.error || 'Your delivery address could not be validated.');
          setStep('details');
        } else {
          setSubmitError(err.error || 'We could not place your order. Please try again.');
        }
        setSubmitting(false);
        return;
      }

      const data = await res.json();

      // When Square is configured, collect card payment before completing.
      if (data.squareEnabled && data.squareAppId && data.squareLocationId) {
        setSessionInfo({
          sessionId: data.sessionId,
          appId: data.squareAppId,
          locationId: data.squareLocationId,
          total: data.totalAmount,
        });
        setStep('payment');
        setSubmitting(false);
        return;
      }

      // Square not configured yet — legacy "order submitted, payment collected
      // separately" path. Only mark complete after the session is created.
      setOrderComplete(true);
      clearCart();
      setSubmitting(false);
    } catch (e) {
      console.error('Session creation error:', e);
      setSubmitError('We could not place your order. Please check your connection and try again.');
      setSubmitting(false);
    }
  };

  /** Tokenize the card and charge it against the payment session. */
  const handlePay = async () => {
    if (!squareCardRef.current || !sessionInfo) return;
    setPaying(true);
    setPaymentError('');
    try {
      const tokenResult = await squareCardRef.current.tokenize();
      if (tokenResult.status !== 'OK' || !tokenResult.token) {
        setPaymentError(tokenResult.errors?.[0]?.message || 'Please check your card details.');
        setPaying(false);
        return;
      }

      const res = await fetch('/api/payments/create-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionInfo.sessionId, sourceId: tokenResult.token }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        setPaymentError(data.error || 'Your payment could not be processed. Please try again.');
        setPaying(false);
        return;
      }

      setOrderNumber(data.orderNumber || '');
      setOrderComplete(true);
      clearCart();
    } catch (e) {
      console.error('Payment error:', e);
      setPaymentError('Payment failed. Please try again.');
    } finally {
      setPaying(false);
    }
  };

  const canSubmitPickup =
    pickupDate && pickupLocationId && pickupName.trim() && pickupPhone.trim() && pickupEmail.trim();
  const canSubmitDelivery =
    deliveryName.trim() &&
    deliveryPhone.trim() &&
    deliveryEmail.trim() &&
    deliveryAddressLine1.trim() &&
    deliveryCity.trim() &&
    deliveryState.trim() &&
    deliveryZip.trim();

  /** Reset address-validation state whenever a delivery address field changes. */
  const resetAddressValidation = () => {
    if (validatedAddress) setValidatedAddress(null);
    if (addressSuggestion) setAddressSuggestion(null);
    if (addressError) setAddressError('');
  };

  /**
   * Validate the delivery address (UX pre-check) before advancing to review.
   * - valid     → proceed to confirm
   * - corrected → show suggestion for confirmation
   * - otherwise → show an inline error and stay on the form
   */
  const handleReviewDelivery = async () => {
    setAddressError('');
    setAddressSuggestion(null);
    setValidatedAddress(null);
    setValidatingAddress(true);
    try {
      const res = await fetch('/api/address/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          addressLine1: deliveryAddressLine1,
          addressLine2: deliveryAddressLine2,
          city: deliveryCity,
          state: deliveryState,
          zip: deliveryZip,
        }),
      });

      if (!res.ok) {
        setAddressError('We could not validate your address right now. Please try again.');
        return;
      }

      const result: AddressValidationResult = await res.json();
      if (isAddressValidationFailure(result)) {
        setAddressError(result.message || 'Please enter a valid U.S. delivery address.');
      } else if (result.status === 'valid') {
        setValidatedAddress(result.normalized);
        setStep('confirm');
      } else {
        // 'corrected' — show the suggestion for confirmation
        setAddressSuggestion(result.normalized);
      }
    } catch {
      setAddressError('We could not validate your address. Please check your connection and try again.');
    } finally {
      setValidatingAddress(false);
    }
  };

  /** User accepted Google's corrected address — apply it and proceed. */
  const acceptSuggestedAddress = () => {
    if (!addressSuggestion) return;
    setDeliveryAddressLine1(addressSuggestion.addressLine1);
    setDeliveryAddressLine2(addressSuggestion.addressLine2);
    setDeliveryCity(addressSuggestion.city);
    setDeliveryState(addressSuggestion.state);
    setDeliveryZip(addressSuggestion.zip);
    setDeliveryCountry('USA');
    setValidatedAddress(addressSuggestion);
    setAddressSuggestion(null);
    setStep('confirm');
  };

  return (
    <div className="section-padding py-12 sm:py-16 max-w-3xl mx-auto">
      {/* Banner */}
      <div className="bg-brand-gold/10 border border-brand-gold/30 rounded-xl p-4 mb-8 flex items-start gap-3">
        <Clock size={20} className="text-brand-gold shrink-0 mt-0.5" />
        <div className="font-body text-sm text-brand-charcoal/80">
          <p className="font-semibold">Please place your orders before 1:30 PM for same-day pickup.</p>
          <p>All sweets are freshly baked daily.</p>
        </div>
      </div>

      {largeOrder && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <AlertTriangle size={20} className="text-amber-600 shrink-0 mt-0.5" />
          <p className="font-body text-sm text-amber-700">
            Your order has {totalPieces} pieces. Orders above 150 pieces require
            minimum 1 day prior notice. Same-day pickup is disabled.
          </p>
        </div>
      )}

      <h1 className="font-display text-3xl font-bold text-brand-charcoal mb-6">
        Checkout
      </h1>

      {/* Order summary — always visible (the confirm step has its own detailed copy) */}
      {step !== 'confirm' && (
        <div className="card p-4 mb-8 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-brand-charcoal">
              Your Order
            </h2>
            <Link
              href="/"
              className="font-body text-xs text-brand-maroon hover:underline"
            >
              + Add more
            </Link>
          </div>
          <div className="space-y-2">
            {items.map((item) => (
              <div
                key={`${item.productId}-${item.selectedTier}`}
                className="flex justify-between items-start gap-3 font-body text-sm"
              >
                <span className="text-brand-charcoal/80">
                  {item.product.name}
                  {item.selectedTier ? ` (${item.selectedTier} pcs)` : ''}
                  <span className="text-brand-charcoal/40"> × {item.quantity}</span>
                </span>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-medium text-brand-charcoal">
                    {formatCurrency(item.lineTotal)}
                  </span>
                  <button
                    onClick={() => removeItem(item.productId, item.selectedTier)}
                    aria-label={`Remove ${item.product.name}`}
                    className="text-brand-charcoal/30 hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-brand-cream-dark pt-3 flex justify-between font-display text-base font-bold">
            <span>Subtotal</span>
            <span className="text-brand-maroon">{formatCurrency(subtotal)}</span>
          </div>
        </div>
      )}

      {/* Step 1: Choose fulfillment */}
      {step === 'fulfillment' && (
        <div className="space-y-4">
          <p className="font-body text-sm text-brand-charcoal/60 mb-4">
            How would you like to receive your order?
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            <button
              onClick={() => {
                setFulfillmentType('pickup');
                setStep('details');
              }}
              className="card p-6 text-left hover:border-brand-maroon transition-colors group"
            >
              <MapPin
                size={28}
                className="text-brand-maroon mb-3 group-hover:scale-110 transition-transform"
              />
              <h3 className="font-display text-xl font-semibold text-brand-charcoal">
                Pickup
              </h3>
              <p className="font-body text-sm text-brand-charcoal/60 mt-1">
                Pick up from our partner locations across DFW.
              </p>
            </button>
            <button
              onClick={() => {
                setFulfillmentType('delivery');
                setStep('details');
              }}
              className="card p-6 text-left hover:border-brand-maroon transition-colors group"
            >
              <Truck
                size={28}
                className="text-brand-maroon mb-3 group-hover:scale-110 transition-transform"
              />
              <h3 className="font-display text-xl font-semibold text-brand-charcoal">
                Delivery
              </h3>
              <p className="font-body text-sm text-brand-charcoal/60 mt-1">
                We&apos;ll deliver to your doorstep within 24–48 hours.
              </p>
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Details */}
      {step === 'details' && fulfillmentType === 'pickup' && (
        <div className="space-y-6">
          <button
            onClick={() => setStep('fulfillment')}
            className="font-body text-sm text-brand-charcoal/50 hover:text-brand-maroon flex items-center gap-1"
          >
            <ArrowLeft size={14} /> Back
          </button>

          <h2 className="font-display text-xl font-semibold text-brand-charcoal">
            Pickup Details
          </h2>

          <div>
            <label className="label-text">Pickup Date</label>
            <input
              type="date"
              min={minPickupDate}
              value={pickupDate}
              onChange={(e) => {
                setPickupDate(e.target.value);
                e.target.blur();
              }}
              className="input-field"
            />
            {largeOrder && pickupDate && pickupDate < minPickupDate && (
              <p className="text-red-500 text-xs mt-1">
                Large orders require at least 1 day notice.
              </p>
            )}
          </div>

          <div>
            <label className="label-text">Pickup Location</label>
            <select
              value={pickupLocationId}
              onChange={(e) => setPickupLocationId(e.target.value)}
              className="input-field"
            >
              <option value="">Select a location</option>
              {PICKUP_LOCATIONS.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
            {selectedLocation && (
              <p className="font-body text-xs text-brand-charcoal/60 mt-2 bg-brand-cream rounded-lg p-3">
                📍 {selectedLocation.address}, {selectedLocation.city},{' '}
                {selectedLocation.state} {selectedLocation.zip}
              </p>
            )}
          </div>

          {pickupLocationId && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <p className="font-body text-sm text-blue-800">
                Please pick up your orders between{' '}
                <span className="font-semibold">6:30 PM and 1:30 AM</span> at
                the selected pickup location.
              </p>
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="label-text">Your Name</label>
              <input
                type="text"
                value={pickupName}
                onChange={(e) => setPickupName(e.target.value)}
                placeholder="Full name"
                className="input-field"
              />
            </div>
            <div>
              <label className="label-text">Phone Number</label>
              <input
                type="tel"
                value={pickupPhone}
                onChange={(e) => setPickupPhone(e.target.value)}
                placeholder="(xxx) xxx-xxxx"
                className="input-field"
              />
            </div>
          </div>

          <div>
            <label className="label-text">Email Address</label>
            <input
              type="email"
              value={pickupEmail}
              onChange={(e) => setPickupEmail(e.target.value)}
              placeholder="you@example.com"
              className="input-field"
            />
            <p className="font-body text-xs text-brand-charcoal/50 mt-1">
              Order confirmation will be sent to this email.
            </p>
          </div>

          <button
            onClick={() => setStep('confirm')}
            disabled={!canSubmitPickup}
            className="btn-primary w-full"
          >
            Review Order
          </button>
        </div>
      )}

      {step === 'details' && fulfillmentType === 'delivery' && (
        <div className="space-y-6">
          <button
            onClick={() => setStep('fulfillment')}
            className="font-body text-sm text-brand-charcoal/50 hover:text-brand-maroon flex items-center gap-1"
          >
            <ArrowLeft size={14} /> Back
          </button>

          <h2 className="font-display text-xl font-semibold text-brand-charcoal">
            Delivery Details
          </h2>

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-1">
            <p className="font-body text-sm text-blue-800 font-semibold">
              Standard shipping times applicable.
            </p>
            <p className="font-body text-sm text-blue-700">
              Orders are typically delivered within 24–48 hours from the date of
              order. Additional shipping charges may apply depending on location.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="label-text">Your Name</label>
              <input
                type="text"
                value={deliveryName}
                onChange={(e) => setDeliveryName(e.target.value)}
                className="input-field"
                placeholder="Full name"
              />
            </div>
            <div>
              <label className="label-text">Phone Number</label>
              <input
                type="tel"
                value={deliveryPhone}
                onChange={(e) => setDeliveryPhone(e.target.value)}
                className="input-field"
                placeholder="(xxx) xxx-xxxx"
              />
            </div>
          </div>

          <div>
            <label className="label-text">Email</label>
            <input
              type="email"
              value={deliveryEmail}
              onChange={(e) => setDeliveryEmail(e.target.value)}
              className="input-field"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="label-text">Address Line 1</label>
            <input
              type="text"
              value={deliveryAddressLine1}
              onChange={(e) => { setDeliveryAddressLine1(e.target.value); resetAddressValidation(); }}
              className="input-field"
              placeholder="Street address (no PO boxes)"
            />
          </div>

          <div>
            <label className="label-text">Address Line 2 <span className="text-brand-charcoal/40">(optional)</span></label>
            <input
              type="text"
              value={deliveryAddressLine2}
              onChange={(e) => { setDeliveryAddressLine2(e.target.value); resetAddressValidation(); }}
              className="input-field"
              placeholder="Apt, suite, unit, building, floor"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label-text">City</label>
              <input
                type="text"
                value={deliveryCity}
                onChange={(e) => { setDeliveryCity(e.target.value); resetAddressValidation(); }}
                className="input-field"
              />
            </div>
            <div>
              <label className="label-text">State</label>
              <input
                type="text"
                value={deliveryState}
                onChange={(e) => { setDeliveryState(e.target.value); resetAddressValidation(); }}
                className="input-field"
                placeholder="TX"
                maxLength={2}
              />
            </div>
            <div>
              <label className="label-text">ZIP</label>
              <input
                type="text"
                value={deliveryZip}
                onChange={(e) => { setDeliveryZip(e.target.value); resetAddressValidation(); }}
                className="input-field"
                placeholder="75074"
              />
            </div>
          </div>

          <div>
            <label className="label-text">Country</label>
            <input
              type="text"
              value={deliveryCountry}
              readOnly
              aria-readonly="true"
              className="input-field bg-brand-cream/60 cursor-not-allowed"
            />
            <p className="font-body text-xs text-brand-charcoal/50 mt-1">
              We currently deliver within the United States only.
            </p>
          </div>

          {/* Validation error */}
          {addressError && (
            <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl p-3.5">
              <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
              <p className="font-body text-sm text-red-700">{addressError}</p>
            </div>
          )}

          {/* Corrected-address suggestion */}
          {addressSuggestion && (
            <div className="bg-brand-gold/10 border border-brand-gold/40 rounded-xl p-4 space-y-3">
              <p className="font-body text-sm font-semibold text-brand-charcoal">
                We found a verified version of your address:
              </p>
              <p className="font-body text-sm text-brand-charcoal/80 bg-white rounded-lg p-3 whitespace-pre-line">
                {addressSuggestion.formatted}
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <button onClick={acceptSuggestedAddress} className="btn-primary flex-1">
                  Use this address
                </button>
                <button
                  onClick={() => setAddressSuggestion(null)}
                  className="btn-secondary flex-1"
                >
                  Keep editing
                </button>
              </div>
            </div>
          )}

          <button
            onClick={handleReviewDelivery}
            disabled={!canSubmitDelivery || validatingAddress}
            className="btn-primary w-full gap-2"
          >
            {validatingAddress ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Validating address…
              </>
            ) : (
              'Review Order'
            )}
          </button>
        </div>
      )}

      {/* Step 3: Confirm */}
      {step === 'confirm' && (
        <div className="space-y-6">
          <button
            onClick={() => setStep('details')}
            className="font-body text-sm text-brand-charcoal/50 hover:text-brand-maroon flex items-center gap-1"
          >
            <ArrowLeft size={14} /> Back
          </button>

          <h2 className="font-display text-xl font-semibold text-brand-charcoal">
            Review Your Order
          </h2>

          {/* Items summary */}
          <div className="card p-4 space-y-3">
            {items.map((item) => (
              <div
                key={`${item.productId}-${item.selectedTier}`}
                className="flex justify-between font-body text-sm"
              >
                <span>
                  {item.product.name}
                  {item.selectedTier ? ` (${item.selectedTier} pcs)` : ''} × {item.quantity}
                </span>
                <span className="font-medium">{formatCurrency(item.lineTotal)}</span>
              </div>
            ))}
            <div className="border-t pt-3 space-y-2">
              <div className="flex justify-between font-body text-sm text-brand-charcoal/60">
                <span>Subtotal</span>
                <span>{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex justify-between font-body text-sm text-brand-charcoal/60">
                <span>Tax</span>
                <span>$0.00 (Food exempt)</span>
              </div>
              <div className="flex justify-between font-display text-lg font-bold border-t pt-2">
                <span>Total</span>
                <span className="text-brand-maroon">{formatCurrency(subtotal)}</span>
              </div>
            </div>
          </div>

          {/* Fulfillment summary */}
          <div className="card p-4 space-y-2">
            <h3 className="font-body text-sm font-semibold text-brand-charcoal">
              {fulfillmentType === 'pickup' ? 'Pickup' : 'Delivery'} Details
            </h3>
            {fulfillmentType === 'pickup' ? (
              <>
                <p className="font-body text-sm text-brand-charcoal/60">
                  Date: {pickupDate}
                </p>
                <p className="font-body text-sm text-brand-charcoal/60">
                  Location: {selectedLocation?.name}
                </p>
                <p className="font-body text-sm text-brand-charcoal/60">
                  Name: {pickupName}
                </p>
                <p className="font-body text-sm text-brand-charcoal/60">
                  Phone: {pickupPhone}
                </p>
                <p className="font-body text-sm text-brand-charcoal/60">
                  Email: {pickupEmail}
                </p>
              </>
            ) : (
              <>
                <p className="font-body text-sm text-brand-charcoal/60">
                  Name: {deliveryName}
                </p>
                <p className="font-body text-sm text-brand-charcoal/60">
                  Phone: {deliveryPhone}
                </p>
                <p className="font-body text-sm text-brand-charcoal/60">
                  Email: {deliveryEmail}
                </p>
                <p className="font-body text-sm text-brand-charcoal/60">
                  {deliveryAddressLine1}
                </p>
                {deliveryAddressLine2 && (
                  <p className="font-body text-sm text-brand-charcoal/60">
                    {deliveryAddressLine2}
                  </p>
                )}
                <p className="font-body text-sm text-brand-charcoal/60">
                  {deliveryCity}, {deliveryState} {deliveryZip}
                </p>
                <p className="font-body text-sm text-brand-charcoal/60">
                  {deliveryCountry}
                </p>
              </>
            )}
          </div>

          {submitError && (
            <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl p-3.5">
              <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
              <p className="font-body text-sm text-red-700">{submitError}</p>
            </div>
          )}

          <button
            onClick={handleSubmitOrder}
            disabled={submitting}
            className="btn-primary w-full gap-2"
          >
            {submitting ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Placing Order…
              </>
            ) : (
              'Place Order'
            )}
          </button>
        </div>
      )}

      {/* Step 4: Payment (only when Square is configured) */}
      {step === 'payment' && sessionInfo && (
        <div className="space-y-6">
          <button
            onClick={() => {
              setPaymentError('');
              setStep('confirm');
            }}
            className="font-body text-sm text-brand-charcoal/50 hover:text-brand-maroon flex items-center gap-1"
          >
            <ArrowLeft size={14} /> Back
          </button>

          <h2 className="font-display text-xl font-semibold text-brand-charcoal">
            Payment
          </h2>

          <div className="card p-4 flex justify-between items-center">
            <span className="font-body text-sm text-brand-charcoal/60">Amount due</span>
            <span className="font-display text-xl font-bold text-brand-maroon">
              {formatCurrency(sessionInfo.total)}
            </span>
          </div>

          <div className="card p-5 space-y-4">
            <label className="label-text">Card details</label>
            {/* Square mounts a secure iframe card field into this container */}
            <div id="square-card-container" className="min-h-[44px]" />
            {!cardReady && !paymentError && (
              <p className="font-body text-xs text-brand-charcoal/40 flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" /> Loading secure payment form…
              </p>
            )}
            <p className="font-body text-xs text-brand-charcoal/40">
              Payments are processed securely by Square. We never see your card number.
            </p>
          </div>

          {paymentError && (
            <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl p-3.5">
              <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
              <p className="font-body text-sm text-red-700">{paymentError}</p>
            </div>
          )}

          <button
            onClick={handlePay}
            disabled={!cardReady || paying}
            className="btn-primary w-full gap-2"
          >
            {paying ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Processing payment…
              </>
            ) : (
              `Pay ${formatCurrency(sessionInfo.total)}`
            )}
          </button>
        </div>
      )}
    </div>
  );
}
