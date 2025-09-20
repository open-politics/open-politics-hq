import './globals.css';
import { cn } from "@/lib/utils";
import { fontSans, fontMono } from "@/lib/fonts";
import { ReactNode } from 'react';
import ClientWrapper from './ClientWrapper';
import BackgroundImage from '@/components/collection/unsorted/BackgroundImage';
import { ToastProvider, ToastViewport } from '@/components/ui/toast';
import Footer from '@/components/collection/unsorted/Footer';
import { AppStateProvider } from '@/lib/utils/app-state'
import { AI } from './xactions';
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"


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
            <AI>
          <SidebarProvider>
              <SidebarInset>
                <ClientWrapper>
                  <BackgroundImage />
                  <ToastProvider>
                    {children}
                    <ToastViewport />
                  </ToastProvider>
                  {/* <Footer /> */}
                </ClientWrapper>
              </SidebarInset>
          </SidebarProvider>
            </AI>
          </AppStateProvider>
      </body>
    </html>
  );
}