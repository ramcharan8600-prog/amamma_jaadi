'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import { MIN_ADDRESS_INPUT, type AddressSuggestion, type ResolvedAddress } from '@/lib/address-autocomplete';

interface Props {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** The customer tapped a suggestion and Google returned its address. */
  onSelect: (address: ResolvedAddress) => void;
  /** Suggestions appeared for the first time this visit (tracking). */
  onSuggestionsShown?: () => void;
  className?: string;
  placeholder?: string;
  autoComplete?: string;
}

const DEBOUNCE_MS = 300;

/**
 * Address Line 1 with Google address suggestions under it. Purely additive:
 * typing by hand, browser autofill and every other field work exactly as
 * before, and if suggestions are off or fail nothing appears at all.
 */
export default function AddressAutocomplete({
  id, value, onChange, onSelect, onSuggestionsShown, className, placeholder, autoComplete,
}: Props) {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const enabledRef = useRef(true);
  const sessionRef = useRef('');
  const requestRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const shownRef = useRef(false);
  const listId = `${id}-suggestions`;

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const session = () => {
    if (!sessionRef.current) sessionRef.current = crypto.randomUUID();
    return sessionRef.current;
  };

  const close = useCallback(() => {
    requestRef.current += 1;
    clearTimeout(timerRef.current);
    setOpen(false);
    setActive(-1);
  }, []);

  const lookup = (text: string) => {
    clearTimeout(timerRef.current);
    const request = ++requestRef.current;
    if (!enabledRef.current || text.trim().length < MIN_ADDRESS_INPUT) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/address/suggest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: text, sessionToken: session() }),
        });
        const data = await res.json() as { enabled?: boolean; suggestions?: AddressSuggestion[] };
        if (data.enabled === false) enabledRef.current = false;
        // Ignore a slow answer to older typing, or one that lands after leaving the field.
        if (request !== requestRef.current || document.activeElement !== inputRef.current) return;
        const list = Array.isArray(data.suggestions) ? data.suggestions : [];
        setSuggestions(list);
        setActive(-1);
        setOpen(list.length > 0);
        if (list.length > 0 && !shownRef.current) {
          shownRef.current = true;
          onSuggestionsShown?.();
        }
      } catch {
        // Suggestions are a convenience; the customer can always type the address.
      }
    }, DEBOUNCE_MS);
  };

  const choose = async (suggestion: AddressSuggestion) => {
    const sessionToken = session();
    // Google bills one session per looked-up address; the next search starts a new one.
    sessionRef.current = '';
    close();
    onChange(suggestion.main);
    try {
      const res = await fetch('/api/address/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placeId: suggestion.placeId, sessionToken }),
      });
      const data = await res.json() as { address?: ResolvedAddress | null };
      if (data.address) onSelect(data.address);
    } catch {
      // Keep the street the customer picked; they fill in the rest.
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      void choose(suggestions[active]);
    } else if (e.key === 'Escape') {
      close();
    }
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          lookup(e.target.value);
        }}
        onKeyDown={onKeyDown}
        onBlur={close}
        className={className}
        placeholder={placeholder}
        autoComplete={autoComplete}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
      />
      {open && suggestions.length > 0 && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-brand-cream-dark rounded-xl shadow-lg overflow-hidden">
          <ul id={listId} role="listbox" aria-label="Address suggestions">
            {suggestions.map((s, i) => (
              <li
                key={s.placeId}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                // mousedown, not click: the input's blur would close the list first.
                onMouseDown={(e) => {
                  e.preventDefault();
                  void choose(s);
                }}
                className={`flex items-start gap-2 px-3 py-2.5 cursor-pointer font-body text-sm ${i === active ? 'bg-brand-cream' : 'hover:bg-brand-cream/60'}`}
              >
                <MapPin size={16} className="text-brand-maroon shrink-0 mt-0.5" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block font-semibold text-brand-charcoal truncate">{s.main}</span>
                  {s.secondary && <span className="block text-xs text-brand-charcoal/60 truncate">{s.secondary}</span>}
                </span>
              </li>
            ))}
          </ul>
          {/* Google Maps text attribution, as Google's Places policies require. */}
          <p className="px-3 py-1.5 border-t border-brand-cream-dark text-right">
            <span
              translate="no"
              style={{ fontFamily: 'Roboto, sans-serif', fontWeight: 400, fontSize: '12px', color: '#5E5E5E', whiteSpace: 'nowrap', letterSpacing: 'normal' }}
            >
              Google Maps
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
