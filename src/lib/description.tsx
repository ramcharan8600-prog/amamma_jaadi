import { Fragment, type ReactNode } from 'react';

function renderInline(text: string): ReactNode {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) =>
    i % 2 === 1
      ? <strong key={i} className="font-semibold text-brand-charcoal">{part}</strong>
      : <Fragment key={i}>{part}</Fragment>
  );
}

/**
 * Product descriptions may mark a phrase with **double asterisks**, which the
 * storefront renders bold. A description with line breaks shows one line per
 * line; a line starting with "* " is a bullet. Lines are spans so the result
 * stays valid inside a <p>.
 */
export function renderDescription(text: string): ReactNode {
  if (!text.includes('\n')) return renderInline(text);
  return text.split('\n').map((line, i) => {
    const bullet = line.startsWith('* ');
    return (
      <span key={i} className={bullet ? 'block pl-4 -indent-3' : 'block'}>
        {bullet && '• '}{renderInline(bullet ? line.slice(2) : line)}
      </span>
    );
  });
}

/** Description without markers or line breaks — for metadata and structured data. */
export function plainDescription(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').split('\n')
    .map((line) => line.replace(/^\* /, '').trim()).filter(Boolean).join(' · ');
}
