'use client';

import { useEffect } from 'react';

/**
 * Opens a page at its #section (/about#refund-policy, /sweets#bobbatlu). Shop links
 * are full page loads (the pages are static files, see Header.tsx), and on a full
 * load the browser looks for the section before the page has finished building it,
 * so it stayed at the top. This jumps there once the page is on screen.
 */
export default function ScrollToHash() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView({ behavior: 'instant', block: 'start' });
  }, []);
  return null;
}
