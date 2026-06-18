/**
 * Trim, length-cap, and strip angle brackets from untrusted string input
 * before it's persisted or echoed. Non-strings collapse to ''.
 */
export function sanitize(val: unknown, maxLen = 500): string {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen).replace(/[<>]/g, '');
}
