/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // Only apply rewrites in the development environment
    if (process.env.NODE_ENV === 'development') {
      return [
        {
          source: '/socket.io/:path*',
          destination: 'http://localhost:4000/socket.io/:path*',
        },
      ];
    }
    // Return an empty array for production
    return [];
  },
};

module.exports = nextConfig;