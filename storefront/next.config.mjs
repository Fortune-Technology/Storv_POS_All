/** @type {import('next').NextConfig} */
const nextConfig = {
  // NOTE: `output: 'standalone'` was removed. Standalone mode is intended for
  // Docker / serverless deploys that run `node .next/standalone/server.js`
  // directly. It deliberately does NOT include `.next/static/` or `public/`
  // — those must be copied alongside or served by a CDN.
  //
  // Our PM2 deploy runs `next start` (see .github/workflows/deploy.yml), which
  // expects the regular `.next/` layout. Mixing the two produces 404s on the
  // CSS / JS chunks and the page renders unstyled (Times New Roman fallback).
  // If we ever switch to a Docker/standalone runtime, re-enable this AND
  // update the deploy to copy `.next/static/` + `public/` into the standalone
  // output and run the standalone server.

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
