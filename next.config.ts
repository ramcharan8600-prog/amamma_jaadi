import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  // Don't advertise the framework in response headers.
  poweredByHeader: false,
  images: {
    // Cloudflare Workers doesn't run Next's image optimizer, so product photos are
    // pre-built in several widths (scripts/build-photos.mjs) and served as direct,
    // edge-cached static assets. The loader picks the right width for each screen.
    loader: 'custom',
    loaderFile: './src/lib/image-loader.ts',
  },
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
};

export default nextConfig;

// Enables Cloudflare bindings (env, KV, R2, etc.) during `next dev`.
// No-op in production builds.
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';
initOpenNextCloudflareForDev();
