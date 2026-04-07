/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Keep server components lean; we intentionally stream from route handlers.
  },
};

module.exports = nextConfig;
