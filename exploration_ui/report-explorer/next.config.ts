import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Produce a self-contained server bundle in .next/standalone.
  // Required by the multi-stage Dockerfile — runner stage copies only
  // .next/standalone, public/, and .next/static (no node_modules needed).
  output: 'standalone',

  experimental: {
    serverActions: {
      allowedOrigins: [
        'localhost:3000',
        'frontend-networkrail-gap-engine.apps.itz-klvg6u.infra01-lb.lon04.techzone.ibm.com',
      ],
    },
  },

  env: {
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
  },

  async headers() {
    return [
      {
        source: '/api/auth/:path*',
        headers: [
          { key: 'X-Frame-Options',           value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options',    value: 'nosniff' },
        ],
      },
    ];
  },
};

export default nextConfig;
