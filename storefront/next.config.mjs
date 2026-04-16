/** @type {import('next').NextConfig} */
const nextConfig = {
  // `output: 'standalone'` is ONLY for production builds (Docker / self-hosted
  // deploy). Leaving it on conflicts with `next dev` — it causes next to emit
  // production-style artifacts into .next/ on every build, which then breaks
  // the dev server's on-demand chunk hashing and produces 404s for
  // /_next/static/chunks/*.js on localhost.
  // Gate it behind NODE_ENV so dev mode uses the default output.
  ...(process.env.NODE_ENV === 'production' ? { output: 'standalone' } : {}),

  reactStrictMode: true,

  images: {
    domains: ['localhost'],
    unoptimized: true,
  },

  env: {
    ECOM_API_URL: process.env.ECOM_API_URL || 'http://localhost:5005/api',
    REVALIDATE_SECRET: process.env.REVALIDATE_SECRET || '',
  },
};

export default nextConfig;
