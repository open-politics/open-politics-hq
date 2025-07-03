import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Open Politics HQ',
    short_name: 'OpenPolitics',
    description: 'A Progressive Web App for Open Politics HQ',
    start_url: '/',
    id: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#000000',
    categories: ['politics', 'news', 'social'],
    icons: [
      {
        src: '/icon-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    screenshots: [
      {
        src: '/screenshot1.png',
        sizes: '1080x1920',
        type: 'image/png',
        label: 'Open Politics HQ Home Screen'
      }
    ],
    prefer_related_applications: false,
    scope: '/'
  }
} 