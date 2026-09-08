import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Mongoose ships Node-only internals; keep it out of the bundler's traced graph.
  serverExternalPackages: ['mongoose', '@node-rs/argon2'],
  typedRoutes: true,
  // Reference tables are read from disk at runtime so scripts, tests and route handlers share
  // one code path. Trace them into the deployment bundle or the Impact Agent has no factors.
  outputFileTracingIncludes: {
    '/**': ['./data/**'],
  },
};

export default nextConfig;
