import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@eco/database', '@eco/shared'],
};

export default nextConfig;
