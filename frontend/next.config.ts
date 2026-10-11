import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ['@privy-io/react-auth', '@privy-io/api-base', 'x402'],
  images: { loader: 'custom', loaderFile: './src/lib/image-loader.ts' },
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
