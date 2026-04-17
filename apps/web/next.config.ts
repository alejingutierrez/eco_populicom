import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@eco/database', '@eco/shared'],
  async rewrites() {
    return [
      { source: '/dashboard', destination: '/eco-prototype/index.html' },
      { source: '/dashboard/:path*', destination: '/eco-prototype/index.html' },
      { source: '/mentions', destination: '/eco-prototype/index.html' },
      { source: '/sentiment', destination: '/eco-prototype/index.html' },
      { source: '/topics', destination: '/eco-prototype/index.html' },
      { source: '/geography', destination: '/eco-prototype/index.html' },
      { source: '/alerts', destination: '/eco-prototype/index.html' },
      { source: '/settings', destination: '/eco-prototype/index.html' },
    ];
  },
};

export default nextConfig;
