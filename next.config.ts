import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  // Don't advertise the framework in response headers.
  poweredByHeader: false,
  images: {
    // Cloudflare Workers doesn't run Next's image optimizer (it would pass the
    // original through), so serve images as direct, edge-cached static assets.
    // Source files are pre-sized/compressed instead. No Worker round-trip.
    unoptimized: true,
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
