import { defineCloudflareConfig } from '@opennextjs/cloudflare';
import staticAssetsIncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache';

/**
 * Shop pages are built once per release (their content lives in the code), so serve
 * the ready-built HTML from Workers static assets instead of rendering it again for
 * every visit. Read-only: pages change only with a new deploy, which is how they
 * change today. Stock, sold-out dates and delivery limits load in the browser from
 * /api, so they stay live. `enableCacheInterception` answers those pages before
 * the Next.js server even starts.
 */
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  enableCacheInterception: true,
});
