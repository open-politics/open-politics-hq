import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import createMDX from '@next/mdx';
import remarkGfm from 'remark-gfm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  pageExtensions: ['js', 'jsx', 'mdx', 'ts', 'tsx'],
  output: "standalone",
  productionBrowserSourceMaps: true,
  images: {
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
    path: '/_next/image',
    loader: 'default',
    loaderFile: '',
    disableStaticImages: false,
    minimumCacheTTL: 60,
    formats: ['image/webp'],
    dangerouslyAllowSVG: false,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    contentDispositionType: 'attachment',
    unoptimized: false,
  },
  // async headers() {
  //   return [
  //     {
  //       source: '/(.*)',
  //       headers: [
  //         {
  //           key: 'X-Content-Type-Options',
  //           value: 'nosniff',
  //         },
  //         {
  //           key: 'X-Frame-Options',
  //           value: 'DENY',
  //         },
  //         {
  //           key: 'Referrer-Policy',
  //           value: 'strict-origin-when-cross-origin',
  //         },
  //       ],
  //     },
  //     {
  //       source: '/sw.js',
  //       headers: [
  //         {
  //           key: 'Content-Type',
  //           value: 'application/javascript; charset=utf-8',
  //         },
  //         {
  //           key: 'Cache-Control',
  //           value: 'no-cache, no-store, must-revalidate',
  //         },
  //         {
  //           key: 'Content-Security-Policy',
  //           value: "default-src 'self'; script-src 'self'",
  //         },
  //       ],
  //     },
  //   ]
  // },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `http://backend:${process.env.NODE_ENV === 'development' ? process.env.BACKEND_PORT : 8022}/api/:path*`,
      },
      {
        source: "/api/v1/editor/mdx/:folder/:filename",
        destination: `http://backend:8000/api/v1/editor/mdx/:folder/:filename`
      }
    ];
  },
  // webpack: (config, { isServer }) =>  {
  //   config.resolve.alias['@'] = resolve(__dirname, 'src');
  //   return config;
  // },
  turbopack: {
    resolveAlias: {
      '@': './src',
    },
  },
  experimental: {
    serverComponentsHmrCache: true,
    reactCompiler: false,
    optimizePackageImports: [
      '@/components/ui',
      '@amcharts/amcharts5',
      '@fortawesome/react-fontawesome',
      '@fortawesome/free-solid-svg-icons',
      '@emotion/react',
    ],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

const withMDX = createMDX({
  options: {
    remarkPlugins: [remarkGfm],
    rehypePlugins: [],
  },
  experimental: {
    mdxRs: true,
  },
});

// Merge and export the final configuration
export default withMDX(nextConfig);