import './globals.css';
import { cn } from "@/lib/utils";
import { fontSans, fontMono } from "@/lib/fonts";
import { ReactNode } from 'react';
import ClientWrapper from './ClientWrapper';
import BackgroundImage from '@/components/collection/_unsorted_legacy/BackgroundImage';
import { AppStateProvider } from '@/lib/utils/app-state';
import { SidebarProvider } from "@/components/ui/sidebar";

// ``viewportFit: cover`` lets the page extend under iPhone notches and into
// the home-indicator area so ``env(safe-area-inset-*)`` returns real values.
// The graph fullscreen path uses these to push the canvas edge-to-edge
// without putting controls under the notch.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover' as const,
};

// iOS "Add to Home Screen" support. These four tags are what iOS Safari
// looks for to launch the app in chromeless standalone mode (no URL bar,
// no Safari toolbar). Note: this is *not* a full PWA — no manifest, no
// service worker, no offline mode, no Android install prompt. Just the
// minimum for iPhone home-screen install. Going full-PWA later is
// additive — these tags don't conflict with a manifest.
//   - ``capable: true``   → run standalone (chromeless) when launched
//                            from home screen
//   - ``statusBarStyle``  → ``black-translucent`` makes the page extend
//                            *under* the status bar; time/battery glyphs
//                            overlay our background
//   - ``title``           → short label under the home-screen icon
//   - ``icons.apple``     → high-res icon iOS rasterises onto the home
//                            screen instead of taking a screenshot of the
//                            page
export const metadata = {
  appleWebApp: {
    capable: true,
    title: 'HQ',
    statusBarStyle: 'black-translucent' as const,
  },
  icons: {
    apple: '/icon-192x192.png',
  },
};


export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
          className={cn(
            "bg-background font-sans antialiased",
            fontSans.variable,
            fontMono.variable
          )}
        >
          <AppStateProvider>
            <SidebarProvider>
              <ClientWrapper>
                <BackgroundImage />
                {children}
                {/* <Footer /> */}
              </ClientWrapper>
            </SidebarProvider>
          </AppStateProvider>
      </body>
    </html>
  );
}