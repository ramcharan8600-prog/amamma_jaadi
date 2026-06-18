'use client';

import { useState } from 'react';
import { CalendarHeart, CheckCircle2, AlertTriangle } from 'lucide-react';
import { PRODUCTS } from '@/data/products';
import { getMinEventDate } from '@/lib/utils';

const EVENT_TYPES = [
  'Wedding',
  'Engagement',
  'Birthday',
  'Baby Shower',
  'Housewarming',
  'Festival Celebration',
  'Corporate Event',
  'Temple Event',
  'Other',
];

export default function EventsPage() {
  const sweets = PRODUCTS.filter((p) => p.category === 'sweets');
  const minDate = getMinEventDate();

  const [eventType, setEventType] = useState('');
  const [selectedSweets, setSelectedSweets] = useState<string[]>([]);
  const [quantity, setQuantity] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const quantityNum = parseInt(quantity) || 0;
  const validQuantity = quantityNum >= 100;
  const validDate = eventDate >= minDate;

  const canSubmit =
    eventType &&
    selectedSweets.length > 0 &&
    validQuantity &&
    address.trim() &&
    phone.trim() &&
    eventDate &&
    validDate;

  const handleToggleSweet = (id: string) => {
    setSelectedSweets((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);

    try {
      await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType,
          sweetSelection: selectedSweets,
          quantity: quantityNum,
          deliveryAddress: address,
          phone,
          eventDate,
        }),
      });
    } catch (e) {
      console.error('Event submission error:', e);
    }

    setSubmitted(true);
    setSubmitting(false);
  };

  if (submitted) {
    return (
      <div className="section-padding py-24 text-center max-w-lg mx-auto space-y-6">
        <CheckCircle2 size={64} className="mx-auto text-green-500" />
        <h1 className="font-display text-3xl font-bold text-brand-charcoal">
          Inquiry Submitted!
        </h1>
        <p className="font-body text-brand-charcoal/60">
          We&apos;ve received your event inquiry. Our team will reach out within
          24 hours to confirm details and pricing.
        </p>
      </div>
    );
  }

  return (
    <div className="section-padding py-12 sm:py-16 max-w-2xl mx-auto">
      <div className="text-center space-y-3 mb-10">
        <CalendarHeart size={36} className="mx-auto text-brand-gold" />
        <h1 className="font-display text-4xl font-bold text-brand-charcoal">
          Events
        </h1>
        <p className="font-body text-brand-charcoal/60 max-w-md mx-auto">
          We provide sweets for events. Your happy moments become sweeter with
          our authentic freshly made ghee sweets made with love.
        </p>
      </div>

      <div className="card p-6 sm:p-8 space-y-6">
        <div>
          <label className="label-text">Event Type</label>
          <select
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            className="input-field"
          >
            <option value="">Select event type</option>
            {EVENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label-text">Select Sweets</label>
          <div className="grid grid-cols-2 gap-2">
            {sweets.map((sweet) => (
              <label
                key={sweet.id}
                className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${
                  selectedSweets.includes(sweet.id)
                    ? 'border-brand-maroon bg-brand-maroon/5'
                    : 'border-gray-200 hover:border-brand-gold'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedSweets.includes(sweet.id)}
                  onChange={() => handleToggleSweet(sweet.id)}
                  className="sr-only"
                />
                <div
                  className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                    selectedSweets.includes(sweet.id)
                      ? 'bg-brand-maroon border-brand-maroon'
                      : 'border-gray-300'
                  }`}
                >
                  {selectedSweets.includes(sweet.id) && (
                    <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </div>
                <span className="font-body text-sm">{sweet.name}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="label-text">Total Quantity Required</label>
          <input
            type="number"
            min={100}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="Minimum 100 pieces"
            className="input-field"
          />
          {quantity && !validQuantity && (
            <p className="text-red-500 text-xs mt-1">
              Minimum order for events is 100 pieces.
            </p>
          )}
        </div>

        <div>
          <label className="label-text">Event Date</label>
          <input
            type="date"
            min={minDate}
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            className="input-field"
          />
          {eventDate && !validDate && (
            <div className="flex items-center gap-2 mt-1">
              <AlertTriangle size={14} className="text-red-500" />
              <p className="text-red-500 text-xs">
                Bulk event orders require a minimum 1–2 day advance notice.
              </p>
            </div>
          )}
        </div>

        <div>
          <label className="label-text">Delivery Address</label>
          <textarea
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            rows={3}
            placeholder="Full delivery address for the event"
            className="input-field"
          />
        </div>

        <div>
          <label className="label-text">Phone Number</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(xxx) xxx-xxxx"
            className="input-field"
          />
        </div>

        <div className="bg-brand-cream rounded-xl p-4 font-body text-xs text-brand-charcoal/60 space-y-1">
          <p>• Minimum event order: 100 pieces</p>
          <p>• Minimum 1–2 day advance notice required</p>
          <p>• Payment details will be shared after confirmation</p>
        </div>

        <button
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
          className="btn-primary w-full"
        >
          {submitting ? 'Submitting...' : 'Submit Event Inquiry'}
        </button>
      </div>
    </div>
  );
}
