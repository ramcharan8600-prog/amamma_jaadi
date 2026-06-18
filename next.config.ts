import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  images: {
    formats: ['image/avif', 'image/webp'],
  },
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
};

export default nextConfig;
