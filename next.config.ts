import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable aggressive caching in development for better HMR
  ...(process.env.NODE_ENV === 'development' && {
    webpack: (config) => {
      config.cache = false
      return config
    },
  }),

  // Better error overlay and strict mode
  reactStrictMode: true,

  // Externalize Puppeteer/Chromium for serverless PDF generation
  serverExternalPackages: ['@sparticuz/chromium-min', 'puppeteer-core', 'puppeteer'],

  // Optimize package imports for faster builds
  experimental: {
    optimizePackageImports: ['lucide-react', '@radix-ui/react-icons'],
  },

  // Turbopack is enabled by default in Next.js 16
  // but we can configure it further if needed
}

export default nextConfig;
