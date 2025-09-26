'use client'

import { SidebarProvider, SidebarInset, SidebarTrigger, useSidebar } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/collection/unsorted/AppSidebar"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
} from "@/components/ui/breadcrumb"
import LottiePlaceholder from "@/components/ui/lottie-placeholder"
import useAuth from "@/hooks/useAuth"
import { useInfospaceStore } from "@/zustand_stores/storeInfospace"
import { ArrowLeft, Menu as MenuIcon } from "lucide-react"
import { useEffect, useState, useRef } from 'react';
// import createGlobe from "cobe";
import { useTheme } from "next-themes"; 
import { useRouter } from "next/navigation";

// Component that uses the sidebar context
function SidebarContent({ children, user }: { children: React.ReactNode, user: any }) {
  const { open, isMobile } = useSidebar();
  const { resolvedTheme } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // useEffect(() => {
  //   if (!canvasRef.current) return;
    
  //   let phi = 0;
    
  //   // Theme-aware color configurations
  //   const isDark = resolvedTheme === 'dark';
    
  //   let globe;
  //   try {
  //     globe = createGlobe(canvasRef.current, {
  //       devicePixelRatio: 1.5,
  //       width: 1000 * 1.5,
  //       height: 1000 * 1.5,
  //       phi: 0,
  //       theta: 0,
  //       dark: isDark ? 1 : 0,
  //       diffuse: isDark ? 1.2 : 1.8,
  //       mapSamples: 20000,
  //       mapBrightness: isDark ? 6 : 8,
  //       mapBaseBrightness: isDark ? 0 : 0,
  //       // Dark mode: deep blue base | Light mode: white
  //       baseColor: isDark ? [0.1176, 0.2745, 0.4471] : [1, 1, 1],
  //       // Dark mode: purple markers | Light mode: black
  //       markerColor: isDark ? [0.7059, 0.0706, 0.5922] : [0, 0, 0],
  //       // Dark mode: dark purple glow | Light mode: grey
  //       glowColor: isDark ? [0.0667, 0.0471, 0.1647] : [1, 1, 1],
  //       opacity: isDark ? 0.5 : 0.9,
  //       scale: 1,
  //       offset: [0, 0],
  //       markers: [
  //         // longitude latitude - some example locations
  //         { location: [40.7128, -74.006], size: 0.07 },    // New York
  //         { location: [51.5074, -0.1278], size: 0.07 },   // London
  //         { location: [35.6762, 139.6503], size: 0.07 },  // Tokyo
  //         { location: [52.5200, 13.4050], size: 0.07 },   // Berlin
  //       ],
  //       onRender: (state) => {
  //         // Called on every animation frame.
  //         state.phi = phi;
  //         phi += 0.0003;
  //       }
  //     });
  //   } catch (e) {
  //     console.warn("Failed to create globe:", e);
  //   }

  //   return () => {
  //     if (globe) {
  //       globe.destroy();
  //     }
  //   };
  // }, [resolvedTheme]);

  // Shift is now handled purely via CSS using peer state and CSS variables.

  return (
    <>
      <AppSidebar className="fixed md:relative h-full md:h-auto" />
      <SidebarInset
        className="flex-1 flex flex-col relative"
        style={{
          // Drive the globe shift with a CSS variable; animation handled by child wrapper
          ["--globe-shift"]: isMobile
            ? "0px"
            : open
              ? "calc(var(--sidebar-width)/2)"
              : "calc(var(--sidebar-width-icon)/2)",
        } as React.CSSProperties}
      >
        {/* Background Globe */}
        {/* <div className="fixed top-1/2 left-1/2 pointer-events-none z-0 -translate-x-1/2 -translate-y-1/2 ">
          <div className="transition-transform 
                      duration-300 ease-out transform-gpu will-change-transform translate-x-[var(--globe-shift)]
                      dark:scale-105 opacity-50 dark:opacity-80">
            <canvas
              ref={canvasRef}
              style={{ 
                width: 1000,    
                height: 1000, 
                aspectRatio: 1,
                
              }}
            />
          </div>
        </div> */}
        
        <header className="flex h-12 shrink-0 items-centergap-2 px-4 relative z-10">
            <div className="flex items-center gap-2">
              <Breadcrumb className="pr-6 md:pr-2">
                <BreadcrumbList>
                  <BreadcrumbItem>
                    <BreadcrumbLink href="#">
                      <SidebarTrigger 
                        className="size-4 mt-5"
                        icon={
                          <div className="relative h-4 w-4">
                            <MenuIcon
                              className={`absolute h-4 w-4 transition-all duration-200 ease-in-out ${
                                open 
                                  ? 'rotate-90 opacity-0 scale-95' 
                                  : 'rotate-0 opacity-100 scale-100'
                              }`} 
                            />
                            <ArrowLeft 
                              className={`absolute h-4 w-4 transition-all duration-200 ease-in-out ${
                                open 
                                  ? 'rotate-0 opacity-100 scale-100' 
                                  : 'rotate-90 opacity-0 scale-95'
                              }`} 
                            />
                          </div>
                        }
                      />
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            </div>
        </header>
        <main className="flex-1 overflow-hidden relative z-10">
          {children}
        </main>
      </SidebarInset>
    </>
  );
}

export default function HQLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();  
  const activeInfospace = useInfospaceStore.getState().activeInfospace;
  const router = useRouter();
  
  if (typeof window === 'undefined' || isLoading) {
    return <LottiePlaceholder />
  }

  if (!user) {
    router.push('/accounts/login');
    return null;
  }

  return (
    <div className="h-full max-h-screen flex flex-col md:flex-row overflow-hidden">
      <SidebarProvider>
        <SidebarContent user={user}>
          {children}
        </SidebarContent>
      </SidebarProvider>
    </div>
  )
}