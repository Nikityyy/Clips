import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  assetPrefix: process.env.NODE_ENV === 'production' ? './' : undefined,
  images: { unoptimized: true },
  poweredByHeader: false,
  devIndicators: false,
  reactStrictMode: true,
  turbopack: { root: process.cwd() },
};

export default nextConfig;
