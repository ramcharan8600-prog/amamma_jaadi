'use client';

import { useEffect, useId, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Pickup date picker drawn by the site instead of the browser.
 *
 * iPhone Safari's built-in date picker ignores min/max when drawing its
 * calendar, so past dates looked selectable. Here every date outside
 * [min, max] is greyed out and cannot be tapped, on every device. Dates are
 * plain YYYY-MM-DD strings in the business time zone; all math is UTC so a
 * customer's own time zone never shifts a day. Server validation is unchanged.
 */
interface PickupDateCalendarProps {
  id: string;
  value: string;
  /** Earliest selectable date (YYYY-MM-DD). */
  min: string;
  /** Latest selectable date (YYYY-MM-DD). */
  max: string;
  /** Today in the business time zone (YYYY-MM-DD). */
  today: string;
  invalid?: boolean;
  describedBy?: string;
  onChange: (date: string) => void;
  onClose?: () => void;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parse(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function format(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function monthKey(date: string): string {
  return date.slice(0, 7);
}

function shiftMonth(key: string, delta: number): string {
  const d = parse(`${key}-01`);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return format(d).slice(0, 7);
}

function label(date: string, options: Intl.DateTimeFormatOptions): string {
  return parse(date).toLocaleDateString('en-US', { timeZone: 'UTC', ...options });
}

export default function PickupDateCalendar({
  id, value, min, max, today, invalid, describedBy, onChange, onClose,
}: PickupDateCalendarProps) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => monthKey(value && value >= min ? value : min));
  const panelId = useId();

  // Keep the visible month inside the allowed range when the bounds move
  // (e.g. after the 1:30 PM cutoff or midnight).
  useEffect(() => {
    if (month < monthKey(min)) setMonth(monthKey(min));
    else if (month > monthKey(max)) setMonth(monthKey(max));
  }, [min, max, month]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const first = parse(`${month}-01`);
  const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const leadingBlanks = first.getUTCDay();
  const canGoBack = month > monthKey(min);
  const canGoForward = month < monthKey(max);

  const choose = (date: string) => {
    onChange(date);
    setOpen(false);
    onClose?.();
  };

  return (
    <div className="relative" data-min={min} data-max={max}>
      <button
        id={id}
        type="button"
        onClick={() => {
          if (!open) setMonth(monthKey(value && value >= min && value <= max ? value : min));
          setOpen((o) => !o);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        data-invalid={invalid ? 'true' : undefined}
        aria-describedby={describedBy}
        className={`input-field flex items-center justify-between gap-2 text-left ${invalid ? '!border-red-500' : ''}`}
      >
        <span className={value ? 'text-brand-charcoal' : 'text-brand-charcoal/40'}>
          {value
            ? label(value, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
            : 'Choose a pickup date'}
        </span>
        <CalendarDays size={18} className="text-brand-charcoal/50 shrink-0" />
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Choose a pickup date"
          className="mt-2 rounded-2xl border border-brand-cream-dark bg-white p-4 shadow-lg"
        >
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              onClick={() => setMonth(shiftMonth(month, -1))}
              disabled={!canGoBack}
              className="p-2 rounded-full hover:bg-brand-cream disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Previous month"
            >
              <ChevronLeft size={18} />
            </button>
            <p className="font-display text-lg font-semibold text-brand-charcoal" aria-live="polite">
              {label(`${month}-01`, { month: 'long', year: 'numeric' })}
            </p>
            <button
              type="button"
              onClick={() => setMonth(shiftMonth(month, 1))}
              disabled={!canGoForward}
              className="p-2 rounded-full hover:bg-brand-cream disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Next month"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center" role="presentation">
            {WEEKDAYS.map((day) => (
              <span key={day} className="font-body text-[11px] font-semibold uppercase tracking-wide text-brand-charcoal/50 py-1">
                {day}
              </span>
            ))}
            {Array.from({ length: leadingBlanks }, (_, i) => <span key={`blank-${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const date = `${month}-${String(i + 1).padStart(2, '0')}`;
              const unavailable = date < min || date > max;
              const selected = date === value;
              const isToday = date === today;
              return (
                <button
                  key={date}
                  type="button"
                  data-date={date}
                  disabled={unavailable}
                  onClick={() => choose(date)}
                  aria-pressed={selected}
                  aria-label={`${label(date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}${isToday ? ', today' : ''}${unavailable ? ', not available' : ''}`}
                  className={`relative h-10 rounded-full font-body text-sm transition-colors ${
                    selected
                      ? 'bg-brand-maroon text-white font-semibold'
                      : unavailable
                        ? 'text-brand-charcoal/25 line-through cursor-not-allowed'
                        : 'text-brand-charcoal hover:bg-brand-cream font-medium'
                  } ${isToday && !selected ? 'ring-1 ring-brand-gold' : ''}`}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>

          <p className="font-body text-xs text-brand-charcoal/55 mt-3">
            Greyed-out dates aren&apos;t available for pickup.
          </p>
        </div>
      )}
    </div>
  );
}
