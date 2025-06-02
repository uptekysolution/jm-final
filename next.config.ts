import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
    ],
  },
  webpack: (config, { dev, isServer }) => {
    // Modify webpack config here
    if (dev) { // Only in development mode
      config.watchOptions = {
        ...config.watchOptions, // Spread existing options
        ignored: [
          ...(config.watchOptions?.ignored || []), // Spread existing ignored paths
          '**/.git/**',
          '**/node_modules/**',
          '**/.next/**', // Next.js build output
        ],
      };
    }
    return config;
  },
};

export default nextConfig;
