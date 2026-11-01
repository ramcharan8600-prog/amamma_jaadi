import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { buildCsp, HARDENING_HEADERS } from '@/lib/security-headers.mjs';
import { STATIC_SHOP_PAGES, staticFileName, staticPageHeaderRules } from '../../scripts/populate-page-cache.mjs';

const SRC = path.resolve(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe('shop pages served as static files', () => {
  it('lists only pages that are the same for every visitor', () => {
    expect(STATIC_SHOP_PAGES).toEqual(['/', '/sweets', '/pickles', '/gift-boxes', '/events', '/about']);
    for (const page of STATIC_SHOP_PAGES) {
      expect(page.startsWith('/checkout') || page.startsWith('/admin') || page.startsWith('/api')).toBe(false);
    }
  });

  it('names each file the way Workers static assets serve it', () => {
    expect(staticFileName('/')).toBe('index.html');
    expect(staticFileName('/gift-boxes')).toBe('gift-boxes.html');
  });

  it('gives every static page the Worker’s security headers and keeps the sandbox out of Google', () => {
    const rules = staticPageHeaderRules();
    for (const page of STATIC_SHOP_PAGES) expect(rules).toContain(`\n${page}\n`);
    expect(rules.split(`Content-Security-Policy: ${buildCsp()}\n`)).toHaveLength(STATIC_SHOP_PAGES.length + 1);
    for (const [name, value] of HARDENING_HEADERS) expect(rules).toContain(`  ${name}: ${value}\n`);
    expect(rules).toContain('Strict-Transport-Security: max-age=31536000; includeSubDomains');
    expect(rules).toContain('https://:worker.:account.workers.dev/*\n  X-Robots-Tag: noindex, nofollow, noarchive');
  });

  it('stays inside the Cloudflare _headers limits (100 rules, 2,000 characters a line)', () => {
    const file = readFileSync(path.resolve(SRC, '../public/_headers'), 'utf8') + staticPageHeaderRules();
    const ruleCount = file.split('\n').filter((line) => /^(\/|https:)/.test(line)).length;
    expect(ruleCount).toBeLessThanOrEqual(100);
    for (const line of file.split('\n')) expect(line.length).toBeLessThan(2000);
  });

  it('links to them with plain <a>, never next/link (a static file cannot answer router data requests)', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const code = readFileSync(file, 'utf8');
      const relative = path.relative(SRC, file);
      const isAdmin = relative.startsWith('app/admin') || relative.startsWith('components/admin');
      if (!isAdmin && code.includes("from 'next/link'")) offenders.push(`${relative} imports next/link`);
      for (const page of STATIC_SHOP_PAGES) {
        if (code.match(new RegExp(`<Link[^>]*href="${page}(#[^"]*)?"`))) offenders.push(`${relative} links to ${page} with <Link>`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
