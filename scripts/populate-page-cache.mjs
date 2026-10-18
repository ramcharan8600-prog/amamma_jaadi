// Copies the ready-built pages from an OpenNext build into Workers static assets,
// where the static-assets page cache (open-next.config.ts) reads them. This is what
// `opennextjs-cloudflare populateCache` does for that cache, without starting a
// local Workers runtime. Runs after `npm run cf-build` and before every
// `wrangler deploy` (wrangler.jsonc → build.command), so the pages ship whichever
// deploy command is used. With no build present it does nothing; if it were ever
// skipped, pages are simply rendered per visit as before.
import { cpSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const from = path.join(ROOT, '.open-next/cache');
const to = path.join(ROOT, '.open-next/assets/cdn-cgi/_next_cache');

if (existsSync(from)) {
  cpSync(from, to, { recursive: true });
  console.log('Page cache copied into static assets.');
} else {
  console.log('No OpenNext build found; page cache not copied.');
}
