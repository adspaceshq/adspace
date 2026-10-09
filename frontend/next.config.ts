import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ['@privy-io/react-auth', '@privy-io/api-base', 'x402'],
  images: { loader: 'custom', loaderFile: './src/lib/image-loader.ts' },
};

export default nextConfig;

import('@opennextjs/cloudflare').then(m => m.initOpenNextCloudflareForDev());
