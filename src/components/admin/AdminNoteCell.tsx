'use client';

import { useEffect, useState } from 'react';
import { ADMIN_NOTE_MAX } from '@/lib/admin-note';

/** All Orders: the order's private note, edited in place and saved when the box loses focus. */
export default function AdminNoteCell({ orderId, orderNumber, note, onSaved }: {
  orderId: string;
  orderNumber: string;
  note: string | null | undefined;
  onSaved: (note: string | null) => void;
}) {
  const [draft, setDraft] = useState(note ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  useEffect(() => { setDraft(note ?? ''); }, [note]);

  const save = async () => {
    if (draft.trim() === (note ?? '').trim()) return;
    setState('saving');
    try {
      const res = await fetch('/api/orders/note', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, note: draft }),
      });
      const data = await res.json().catch(() => null) as { note?: string | null } | null;
      if (!res.ok) throw new Error('save failed');
      onSaved(data?.note ?? null);
      setState('saved');
    } catch {
      setState('error');
    }
  };

  return (
    <div className="space-y-1">
      <textarea
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setState('idle'); }}
        onBlur={save}
        rows={2}
        maxLength={ADMIN_NOTE_MAX}
        placeholder="Add a note"
        aria-label={`Note for ${orderNumber}`}
        className="input-field py-1.5 text-xs min-w-[180px] resize-y"
      />
      {state !== 'idle' && (
        <p className={`font-body text-[11px] ${state === 'error' ? 'text-red-700' : 'text-brand-charcoal/60'}`}>
          {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : 'Not saved. Try again.'}
        </p>
      )}
    </div>
  );
}
