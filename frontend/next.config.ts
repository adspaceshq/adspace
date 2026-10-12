import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ['@privy-io/react-auth', '@privy-io/api-base'],
  images: { loader: 'custom', loaderFile: './src/lib/image-loader.ts' },
  // Retired legacy routes (audit F-19). Old listing ids do not exist in the v2 store, so
  // /listings/:id has no per-listing target and lands on browse.
  async redirects() {
    return [
      { source: '/list', has: [{ type: 'query', key: 'surface', value: 'apparel' }], destination: '/sell/new?surface=tshirt', permanent: true },
      { source: '/list', destination: '/sell', permanent: true },
      { source: '/list/mac', destination: '/sell/new?surface=laptop', permanent: true },
      { source: '/list/tshirt', destination: '/sell/new?surface=tshirt', permanent: true },
      { source: '/listings/:id', destination: '/browse', permanent: true },
    ];
  },
  // No other site may frame the app (clickjacking on bid, claim and withdraw).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;

import('@opennextjs/cloudflare').then(m => m.initOpenNextCloudflareForDev());
