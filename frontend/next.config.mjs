import createMDX from '@next/mdx';

/** @type {import('next').NextConfig} */
const nextConfig = {
  pageExtensions: ['js', 'jsx', 'mdx', 'ts', 'tsx'],
  output: "standalone",
  // Off: 481 .map files / 94MB of the published image, and a large slice
  // of the build. The frontend is open source, so the maps disclosed
  // nothing that isn't already public — this is purely size and speed.
  productionBrowserSourceMaps: false,
  compress: false,
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
  // Server-side proxy: the browser calls /api on this origin, Next forwards to
  // the backend over the compose network. This is why no NEXT_PUBLIC_API_URL is
  // needed — and why setting one to a compose hostname breaks the browser.
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `http://backend:${process.env.BACKEND_PORT || 8022}/api/:path*`,
      },
    ];
  },
  turbopack: {
    resolveAlias: {
      '@': './src',
    },
  },
  experimental: {
    mdxRs: true,
    // Dev FS caching stays ON (default) — that is what the 16.3 bump is for.
    // The build cache is off: the prod Dockerfile discards .next/cache with the
    // builder stage, so writing it is pure cost.
    turbopackFileSystemCacheForBuild: false,
    serverComponentsHmrCache: true,
    optimizePackageImports: [
      '@/components/ui',
      '@emotion/react',
    ],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

const withMDX = createMDX({
  options: {
    remarkPlugins: ['remark-gfm'],
    rehypePlugins: [],
  },
});

// Merge and export the final configuration
export default withMDX(nextConfig);