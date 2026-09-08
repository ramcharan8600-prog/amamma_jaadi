'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { classifyPaymentOutcome, PAYMENT_PENDING_MESSAGE, requestPaymentStatus, type PendingPayment } from '@/lib/payment-recovery';

interface Props {
  payment: PendingPayment;
  submitting: boolean;
  onCompleted: (sessionId: string, orderNumber: string) => void;
  onReleased: (sessionId: string, message: string) => void;
}

export default function PaymentRecoveryPanel({ payment, submitting, onCompleted, onReleased }: Props) {
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState(PAYMENT_PENDING_MESSAGE);
  const inFlight = useRef(false);
  const active = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    active.current = true;
    const run = ++generation.current;
    return () => { active.current = false; generation.current = run + 1; };
  }, [payment.sessionId]);

  const check = useCallback(async (retry: boolean) => {
    if (inFlight.current || submitting) return;
    inFlight.current = true;
    const run = generation.current;
    setChecking(true);
    try {
      const response = await requestPaymentStatus(retry ? '/api/payments/create-payment' : '/api/payments/verify',
        { sessionId: payment.sessionId, ...(retry ? { retry: true } : {}) });
      const result = classifyPaymentOutcome(response.status, response.body);
      if (!active.current || generation.current !== run) return;
      if (result.kind === 'completed') onCompleted(payment.sessionId, result.orderNumber);
      else if (result.kind === 'released') onReleased(payment.sessionId, result.message);
      else setMessage(result.message);
    } catch {
      if (active.current && generation.current === run) setMessage('We could not confirm the result yet. Your original payment reference is saved. Please check again; do not submit a new payment.');
    } finally {
      inFlight.current = false;
      if (active.current) setChecking(false);
    }
  }, [payment.sessionId, submitting, onCompleted, onReleased]);

  useEffect(() => {
    if (submitting) return;
    void check(false);
    // A short bounded status check, not repeated charges. After one minute,
    // leave a working manual recovery button rather than an endless spinner.
    let polls = 0;
    const timer = window.setInterval(() => {
      if (++polls >= 6) window.clearInterval(timer);
      void check(false);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [check, submitting]);

  return (
    <div className="section-padding py-20 max-w-xl mx-auto space-y-5 text-center">
      <AlertCircle size={44} className="mx-auto text-brand-gold" />
      <h1 className="font-display text-2xl font-bold">Confirming your payment</h1>
      <p role="status" className="font-body text-brand-charcoal/80">{message}</p>
      <p className="font-body text-sm text-brand-charcoal/60">
        This checks or resumes the original attempt with the same payment reference. It does not start a separate charge.
      </p>
      <button className="btn-primary w-full gap-2" disabled={checking || submitting} onClick={() => void check(true)}>
        {checking || submitting ? <><Loader2 size={16} className="animate-spin" /> Checking payment…</> : 'Check / finish this payment'}
      </button>
      <p className="font-body text-xs text-brand-charcoal/60 break-all">Payment reference: {payment.sessionId}</p>
      <a className="underline font-body text-sm" href="https://wa.me/15105745578">Contact Amamma Jaadi if confirmation is delayed</a>
    </div>
  );
}
