/** @type {import('next').NextConfig} */
const API_BASE_URL = process.env.MERCHANT_OS_API_URL || "http://localhost:4030";

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/v1/:path*",
        destination: `${API_BASE_URL}/v1/:path*`
      },
      {
        source: "/health",
        destination: `${API_BASE_URL}/health`
      }
    ];
  }
};

export default nextConfig;
