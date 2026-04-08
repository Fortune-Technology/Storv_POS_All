/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
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
