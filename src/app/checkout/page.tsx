'use client';

import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import Link from 'next/link';
import {
  Clock,
  MapPin,
  Truck,
  ArrowLeft,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Check,
  Package,
  Trash2,
  Loader2,
} from 'lucide-react';
import { useCartStore } from '@/store/cart';
import { PICKUP_LOCATIONS, getPickupLocationById } from '@/data/products';
import { formatCurrency, getMinPickupDate } from '@/lib/utils';
import type {
  FulfillmentType,
  PickupDetails,
  DeliveryDetails,
  NormalizedAddress,
  AddressValidationResult,
} from '@/types';
import { isAddressValidationFailure } from '@/types';

type Step = 'cart' | 'method' | 'details' | 'payment';

const STEP_LABELS: { key: Step | 'done'; label: string }[] = [
  { key: 'cart', label: 'Cart' },
  { key: 'method', label: 'Method' },
  { key: 'details', label: 'Details' },
  { key: 'payment', label: 'Payment' },
  { key: 'done', label: 'Done' },
];

export default function CheckoutPage() {
  const [mounted, setMounted] = useState(false);
  const { items, getSubtotal, getTotalPieces, isLargeOrder, setFulfillment, clearCart, removeItem } =
    useCartStore();

  const [step, setStep] = useState<Step>('cart');
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
  const [deliveryCountry] = useState('USA');
  const [deliveryZip, setDeliveryZip] = useState('');

  // Address-validation state
  const [validatingAddress, setValidatingAddress] = useState(false);
  const [addressError, setAddressError] = useState('');
  const [addressSuggestion, setAddressSuggestion] = useState<NormalizedAddress | null>(null);
  const [validatedAddress, setValidatedAddress] = useState<NormalizedAddress | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [orderComplete, setOrderComplete] = useState(false);
  const [orderNumber, setOrderNumber] = useState('');

  // Square payment state
  const [sessionInfo, setSessionInfo] = useState<{
    sessionId: string;
    total: number;
    appId: string | null;
    locationId: string | null;
  } | null>(null);
  const [cardReady, setCardReady] = useState(false);
  const [applePayReady, setApplePayReady] = useState(false);
  const [paying, setPaying] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const squareCardRef = useRef<SquareCard | null>(null);
  const applePayRef = useRef<SquareApplePay | null>(null);

  useEffect(() => setMounted(true), []);

  // Load the Square Web Payments SDK + mount card/Apple Pay on the payment step.
  useEffect(() => {
    if (step !== 'payment' || !sessionInfo?.appId || !sessionInfo?.locationId) return;
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
        const payments = window.Square.payments(sessionInfo.appId!, sessionInfo.locationId!);

        const card = await payments.card();
        if (cancelled) {
          await card.destroy().catch(() => {});
          return;
        }
        await card.attach('#square-card-container');
        squareCardRef.current = card;
        setCardReady(true);

        // Apple Pay — progressive enhancement. Only initializes on a supported
        // device/browser with a registered domain; otherwise it silently no-ops.
        try {
          const req = payments.paymentRequest({
            countryCode: 'US',
            currencyCode: 'USD',
            total: { amount: sessionInfo.total.toFixed(2), label: 'Amamma Jaadi' },
          });
          const ap = await payments.applePay(req);
          if (!cancelled) {
            applePayRef.current = ap;
            setApplePayReady(true);
          }
        } catch {
          /* Apple Pay not available here — card still works. */
        }
      } catch (e) {
        console.error('Square init failed:', e);
        setPaymentError('We could not load the secure payment form. Please refresh and try again.');
      }
    };
    init();

    return () => {
      cancelled = true;
      setCardReady(false);
      setApplePayReady(false);
      applePayRef.current = null;
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
        <h1 className="font-display text-2xl font-bold text-brand-charcoal">No items to checkout</h1>
        <Link href="/" className="btn-primary inline-flex gap-2">
          <ArrowLeft size={16} /> Go to Shop
        </Link>
      </div>
    );
  }

  // ── Step 5: order complete ─────────────────────────────────────────
  if (orderComplete) {
    return (
      <div className="section-padding py-24 text-center space-y-6 max-w-lg mx-auto">
        <CheckCircle2 size={64} className="mx-auto text-green-500" />
        <p className="font-body text-xs font-semibold tracking-widest text-brand-gold uppercase">
          Step 5
        </p>
        <h1 className="font-display text-3xl font-bold text-brand-charcoal">Payment Confirmed!</h1>
        <p className="font-body text-brand-charcoal/70">
          {orderNumber ? (
            <>
              Your order number is{' '}
              <span className="font-display font-bold text-brand-maroon">{orderNumber}</span>.{' '}
            </>
          ) : null}
          A confirmation email has been sent to your inbox.
        </p>
        <Link href="/" className="btn-primary inline-flex gap-2">
          Continue Shopping
        </Link>
      </div>
    );
  }

  // ── Build fulfillment + create a payment session, then go to payment ──
  const createSessionAndPay = async (fulfillment: PickupDetails | DeliveryDetails) => {
    setSubmitting(true);
    setSubmitError('');
    setFulfillment(fulfillment);
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
          total: subtotal, // reference only — server recomputes authoritatively
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 422 && fulfillment.type === 'delivery') {
          setValidatedAddress(null);
          setAddressError(err.error || 'Your delivery address could not be validated.');
        } else {
          setSubmitError(err.error || 'We could not start checkout. Please try again.');
        }
        setSubmitting(false);
        return;
      }

      const data = await res.json();
      setSessionInfo({
        sessionId: data.sessionId,
        total: data.totalAmount,
        appId: data.squareEnabled ? data.squareAppId : null,
        locationId: data.squareEnabled ? data.squareLocationId : null,
      });
      setStep('payment');
    } catch {
      setSubmitError('We could not start checkout. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const proceedPickup = () =>
    createSessionAndPay({
      type: 'pickup',
      date: pickupDate,
      locationId: pickupLocationId,
      customerName: pickupName,
      phone: pickupPhone,
      email: pickupEmail,
    });

  const buildDelivery = (n: NormalizedAddress | null): DeliveryDetails => ({
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
  });

  const resetAddressValidation = () => {
    if (validatedAddress) setValidatedAddress(null);
    if (addressSuggestion) setAddressSuggestion(null);
    if (addressError) setAddressError('');
  };

  /** Validate the delivery address, then continue to payment (or show a fix). */
  const proceedDelivery = async () => {
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
        await createSessionAndPay(buildDelivery(result.normalized));
      } else {
        setAddressSuggestion(result.normalized); // 'corrected' — confirm first
      }
    } catch {
      setAddressError('We could not validate your address. Please check your connection.');
    } finally {
      setValidatingAddress(false);
    }
  };

  const acceptSuggestedAddress = async () => {
    if (!addressSuggestion) return;
    const n = addressSuggestion;
    setDeliveryAddressLine1(n.addressLine1);
    setDeliveryAddressLine2(n.addressLine2);
    setDeliveryCity(n.city);
    setDeliveryState(n.state);
    setDeliveryZip(n.zip);
    setValidatedAddress(n);
    setAddressSuggestion(null);
    await createSessionAndPay(buildDelivery(n));
  };

  // ── Payment submission (shared by card + Apple Pay) ─────────────────
  const submitPayment = async (token: string) => {
    if (!sessionInfo) return;
    setPaying(true);
    setPaymentError('');
    try {
      const res = await fetch('/api/payments/create-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionInfo.sessionId, sourceId: token }),
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
    } catch {
      setPaymentError('Payment failed. Please try again.');
    } finally {
      setPaying(false);
    }
  };

  const handleCardPay = async () => {
    if (!squareCardRef.current) return;
    setPaying(true);
    setPaymentError('');
    try {
      const result = await squareCardRef.current.tokenize();
      if (result.status !== 'OK' || !result.token) {
        setPaymentError(result.errors?.[0]?.message || 'Please check your card details.');
        setPaying(false);
        return;
      }
      await submitPayment(result.token);
    } catch {
      setPaymentError('Payment failed. Please try again.');
      setPaying(false);
    }
  };

  const handleApplePay = async () => {
    if (!applePayRef.current) return;
    try {
      const result = await applePayRef.current.tokenize();
      if (result.status !== 'OK' || !result.token) {
        setPaymentError(result.errors?.[0]?.message || 'Apple Pay was cancelled.');
        return;
      }
      await submitPayment(result.token);
    } catch {
      setPaymentError('Apple Pay failed. Please try a card instead.');
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

  const currentIndex = STEP_LABELS.findIndex((s) => s.key === step);

  return (
    <div className="section-padding py-12 sm:py-16 max-w-3xl mx-auto">
      {/* Step indicator */}
      <div className="flex items-center justify-between mb-8">
        {STEP_LABELS.map((s, i) => {
          const done = i < currentIndex;
          const active = i === currentIndex;
          return (
            <Fragment key={s.key}>
              <div className="flex flex-col items-center gap-1.5 shrink-0">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center font-body text-sm font-semibold transition-colors ${
                    active
                      ? 'bg-brand-maroon text-white'
                      : done
                        ? 'bg-brand-gold text-white'
                        : 'bg-brand-cream text-brand-charcoal/40'
                  }`}
                >
                  {done ? <Check size={15} /> : i + 1}
                </div>
                <span
                  className={`font-body text-[11px] ${active ? 'text-brand-maroon font-semibold' : 'text-brand-charcoal/40'}`}
                >
                  {s.label}
                </span>
              </div>
              {i < STEP_LABELS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-1 ${done ? 'bg-brand-gold' : 'bg-brand-cream'}`} />
              )}
            </Fragment>
          );
        })}
      </div>

      {/* Same-day notice */}
      <div className="bg-brand-gold/10 border border-brand-gold/30 rounded-xl p-4 mb-6 flex items-start gap-3">
        <Clock size={20} className="text-brand-gold shrink-0 mt-0.5" />
        <div className="font-body text-sm text-brand-charcoal/80">
          <p className="font-semibold">Please place your orders before 1:30 PM for same-day pickup.</p>
          <p>All sweets are freshly baked daily.</p>
        </div>
      </div>

      {largeOrder && step !== 'payment' && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <AlertTriangle size={20} className="text-amber-600 shrink-0 mt-0.5" />
          <p className="font-body text-sm text-amber-700">
            Your order has {totalPieces} pieces. Orders above 150 pieces require minimum 1 day prior
            notice. Same-day pickup is disabled.
          </p>
        </div>
      )}

      {/* ── Step 1: Cart overview ─────────────────────────────────── */}
      {step === 'cart' && (
        <div className="space-y-6">
          <div>
            <h2 className="font-display text-2xl font-bold text-brand-charcoal">Step 1</h2>
            <p className="font-body text-sm text-brand-charcoal/60">Cart overview</p>
          </div>

          <div className="card p-4 space-y-3">
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
            <div className="border-t border-brand-cream-dark pt-3 flex justify-between font-display text-base font-bold">
              <span>Subtotal</span>
              <span className="text-brand-maroon">{formatCurrency(subtotal)}</span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <Link href="/" className="btn-secondary flex-1 text-center">
              + Add more items
            </Link>
            <button onClick={() => setStep('method')} className="btn-primary flex-1">
              Continue
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Delivery method ───────────────────────────────── */}
      {step === 'method' && (
        <div className="space-y-6">
          <button
            onClick={() => setStep('cart')}
            className="font-body text-sm text-brand-charcoal/50 hover:text-brand-maroon flex items-center gap-1"
          >
            <ArrowLeft size={14} /> Back
          </button>
          <div>
            <h2 className="font-display text-2xl font-bold text-brand-charcoal">Step 2</h2>
            <p className="font-body text-sm text-brand-charcoal/60">
              How would you like to receive your order?
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <button
              onClick={() => {
                setFulfillmentType('pickup');
                setStep('details');
              }}
              className="card p-6 text-left hover:border-brand-maroon transition-colors group"
            >
              <MapPin size={28} className="text-brand-maroon mb-3 group-hover:scale-110 transition-transform" />
              <h3 className="font-display text-xl font-semibold text-brand-charcoal">Pickup</h3>
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
              <Truck size={28} className="text-brand-maroon mb-3 group-hover:scale-110 transition-transform" />
              <h3 className="font-display text-xl font-semibold text-brand-charcoal">Delivery</h3>
              <p className="font-body text-sm text-brand-charcoal/60 mt-1">
                We&apos;ll deliver to your doorstep within 24–48 hours.
              </p>
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Pickup details ────────────────────────────────── */}
      {step === 'details' && fulfillmentType === 'pickup' && (
        <div className="space-y-6">
          <button
            onClick={() => setStep('method')}
            className="font-body text-sm text-brand-charcoal/50 hover:text-brand-maroon flex items-center gap-1"
          >
            <ArrowLeft size={14} /> Back
          </button>
          <div>
            <h2 className="font-display text-2xl font-bold text-brand-charcoal">Step 3</h2>
            <p className="font-body text-sm text-brand-charcoal/60">Pickup details</p>
          </div>

          <div>
            <label className="label-text">Pickup Date</label>
            <input
              type="date"
              min={minPickupDate}
              value={pickupDate}
              onChange={(e) => setPickupDate(e.target.value)}
              onClick={(e) => e.currentTarget.showPicker?.()}
              className="input-field cursor-pointer"
            />
            {largeOrder && pickupDate && pickupDate < minPickupDate && (
              <p className="text-red-500 text-xs mt-1">Large orders require at least 1 day notice.</p>
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
                📍 {selectedLocation.address}, {selectedLocation.city}, {selectedLocation.state}{' '}
                {selectedLocation.zip}
              </p>
            )}
          </div>

          {pickupLocationId && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <p className="font-body text-sm text-blue-800">
                Please pick up your orders between{' '}
                <span className="font-semibold">6:30 PM and 1:30 AM</span> at the selected pickup
                location.
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

          {submitError && (
            <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl p-3.5">
              <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
              <p className="font-body text-sm text-red-700">{submitError}</p>
            </div>
          )}

          <button
            onClick={proceedPickup}
            disabled={!canSubmitPickup || submitting}
            className="btn-primary w-full gap-2"
          >
            {submitting ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Starting checkout…
              </>
            ) : (
              'Continue to payment'
            )}
          </button>
        </div>
      )}

      {/* ── Step 3: Delivery details ──────────────────────────────── */}
      {step === 'details' && fulfillmentType === 'delivery' && (
        <div className="space-y-6">
          <button
            onClick={() => setStep('method')}
            className="font-body text-sm text-brand-charcoal/50 hover:text-brand-maroon flex items-center gap-1"
          >
            <ArrowLeft size={14} /> Back
          </button>
          <div>
            <h2 className="font-display text-2xl font-bold text-brand-charcoal">Step 3</h2>
            <p className="font-body text-sm text-brand-charcoal/60">Delivery details</p>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-1">
            <p className="font-body text-sm text-blue-800 font-semibold">
              Standard shipping times applicable.
            </p>
            <p className="font-body text-sm text-blue-700">
              Orders are typically delivered within 24–48 hours from the date of order. Additional
              shipping charges may apply depending on location.
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
              onChange={(e) => {
                setDeliveryAddressLine1(e.target.value);
                resetAddressValidation();
              }}
              className="input-field"
              placeholder="Street address (no PO boxes)"
            />
          </div>

          <div>
            <label className="label-text">
              Address Line 2 <span className="text-brand-charcoal/40">(optional)</span>
            </label>
            <input
              type="text"
              value={deliveryAddressLine2}
              onChange={(e) => {
                setDeliveryAddressLine2(e.target.value);
                resetAddressValidation();
              }}
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
                onChange={(e) => {
                  setDeliveryCity(e.target.value);
                  resetAddressValidation();
                }}
                className="input-field"
              />
            </div>
            <div>
              <label className="label-text">State</label>
              <input
                type="text"
                value={deliveryState}
                onChange={(e) => {
                  setDeliveryState(e.target.value);
                  resetAddressValidation();
                }}
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
                onChange={(e) => {
                  setDeliveryZip(e.target.value);
                  resetAddressValidation();
                }}
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

          {addressError && (
            <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl p-3.5">
              <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
              <p className="font-body text-sm text-red-700">{addressError}</p>
            </div>
          )}

          {addressSuggestion && (
            <div className="bg-brand-gold/10 border border-brand-gold/40 rounded-xl p-4 space-y-3">
              <p className="font-body text-sm font-semibold text-brand-charcoal">
                We found a verified version of your address:
              </p>
              <p className="font-body text-sm text-brand-charcoal/80 bg-white rounded-lg p-3 whitespace-pre-line">
                {addressSuggestion.formatted}
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <button onClick={acceptSuggestedAddress} disabled={submitting} className="btn-primary flex-1 gap-2">
                  {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
                  Use this address
                </button>
                <button onClick={() => setAddressSuggestion(null)} className="btn-secondary flex-1">
                  Keep editing
                </button>
              </div>
            </div>
          )}

          {submitError && (
            <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl p-3.5">
              <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
              <p className="font-body text-sm text-red-700">{submitError}</p>
            </div>
          )}

          {!addressSuggestion && (
            <button
              onClick={proceedDelivery}
              disabled={!canSubmitDelivery || validatingAddress || submitting}
              className="btn-primary w-full gap-2"
            >
              {validatingAddress || submitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />{' '}
                  {validatingAddress ? 'Validating address…' : 'Starting checkout…'}
                </>
              ) : (
                'Continue to payment'
              )}
            </button>
          )}
        </div>
      )}

      {/* ── Step 4: Payment ───────────────────────────────────────── */}
      {step === 'payment' && sessionInfo && (
        <div className="space-y-6">
          <button
            onClick={() => {
              setPaymentError('');
              setStep('details');
            }}
            className="font-body text-sm text-brand-charcoal/50 hover:text-brand-maroon flex items-center gap-1"
          >
            <ArrowLeft size={14} /> Back
          </button>
          <div>
            <h2 className="font-display text-2xl font-bold text-brand-charcoal">Step 4</h2>
            <p className="font-body text-sm text-brand-charcoal/60">Payment method</p>
          </div>

          <div className="card p-4 flex justify-between items-center">
            <span className="font-body text-sm text-brand-charcoal/60">Amount due</span>
            <span className="font-display text-xl font-bold text-brand-maroon">
              {formatCurrency(sessionInfo.total)}
            </span>
          </div>

          {sessionInfo.appId && sessionInfo.locationId ? (
            <>
              {applePayReady && (
                <div className="space-y-3">
                  <button
                    onClick={handleApplePay}
                    disabled={paying}
                    className="w-full h-12 rounded-lg bg-black text-white font-body font-medium flex items-center justify-center gap-2 disabled:opacity-60"
                    aria-label="Pay with Apple Pay"
                  >
                    Pay with Apple Pay
                  </button>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-brand-cream-dark" />
                    <span className="font-body text-xs text-brand-charcoal/40">or pay by card</span>
                    <div className="flex-1 h-px bg-brand-cream-dark" />
                  </div>
                </div>
              )}

              <div className="card p-5 space-y-4">
                <label className="label-text">Card details</label>
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
                onClick={handleCardPay}
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
            </>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-center space-y-2">
              <AlertTriangle size={22} className="text-amber-600 mx-auto" />
              <p className="font-body text-sm text-amber-800 font-semibold">
                Online payment is being set up.
              </p>
              <p className="font-body text-sm text-amber-700">
                We can&apos;t take card payments just yet. Please reach out on WhatsApp to complete
                your order — your cart is saved.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
