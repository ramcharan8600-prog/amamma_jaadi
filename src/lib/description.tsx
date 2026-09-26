import { Fragment, type ReactNode } from 'react';

/**
 * Product descriptions may mark a phrase with **double asterisks**.
 * The storefront renders it bold; everything else gets plain text.
 */
export function renderDescription(text: string): ReactNode {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) =>
    i % 2 === 1
      ? <strong key={i} className="font-semibold text-brand-charcoal">{part}</strong>
      : <Fragment key={i}>{part}</Fragment>
  );
}

/** Description without emphasis markers — for metadata and structured data. */
export function plainDescription(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1');
}
