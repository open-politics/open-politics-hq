import './globals.css';
import { cn } from "@/lib/utils";
import { fontSans, fontMono } from "@/lib/fonts";
import { ReactNode } from 'react';
import ClientWrapper from './ClientWrapper';
import BackgroundImage from '@/components/collection/_unsorted_legacy/BackgroundImage';
import { AppStateProvider } from '@/lib/utils/app-state';
import { SidebarProvider } from "@/components/ui/sidebar";


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