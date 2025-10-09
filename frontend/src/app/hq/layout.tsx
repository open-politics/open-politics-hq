'use client'

import { SidebarInset, SidebarTrigger, useSidebar } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/collection/_unsorted_legacy/AppSidebar"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import LottiePlaceholder from "@/components/ui/lottie-placeholder"
import useAuth from "@/hooks/useAuth"
import { useInfospaceStore } from "@/zustand_stores/storeInfospace"
import { ArrowLeft, Menu as MenuIcon, ExternalLink, X } from "lucide-react"
import { useEffect, useState, useRef } from 'react';
// import createGlobe from "cobe";
import { useTheme } from "next-themes"; 
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";

// Helper to generate breadcrumbs from the current path and infospace
function useBreadcrumbs(activeInfospace: any) {
  const pathname = usePathname();
  // Remove leading/trailing slashes, split into segments
  const segments = pathname
    .replace(/^\/|\/$/g, '')
    .split('/')
    .filter(Boolean);

  // Build up breadcrumb items
  const items: { label: string, href: string }[] = [];
  let href = '';
  segments.forEach((seg, idx) => {
    href += '/' + seg;
    // Special case for infospaces
    if (seg === 'hq') {
      items.push({ label: 'HQ', href: '/hq' });
    } else if (seg === 'infospaces' && activeInfospace) {
      items.push({ label: 'Infospaces', href: '/hq/infospaces' });
      // If next segment is the infospace id, show its name
      if (segments[idx + 1] && segments[idx + 1] === String(activeInfospace.id)) {
        items.push({ label: activeInfospace.name || 'Infospace', href: `/hq/infospaces/${activeInfospace.id}` });
      }
    } else if (
      seg !== 'hq' &&
      seg !== 'infospaces' &&
      (!activeInfospace || seg !== String(activeInfospace.id))
    ) {
      // Capitalize and prettify
      items.push({ label: seg.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), href });
    }
  });

  // If on /hq root, show only HQ
  if (items.length === 0 && segments[0] === 'hq') {
    items.push({ label: 'HQ', href: '/hq' });
  }

  return items;
}

// Component that uses the sidebar context
function SidebarContent({ children, user }: { children: React.ReactNode, user: any }) {
  const { open, isMobile } = useSidebar();
  // const { resolvedTheme } = useTheme();
  // const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeInfospace = useInfospaceStore.getState().activeInfospace;
  const breadcrumbs = useBreadcrumbs(activeInfospace);
  const [isMobileBannerDismissed, setIsMobileBannerDismissed] = useState(false);
  const mainContentRef = useRef<HTMLDivElement>(null);

  // Keyboard shortcut to focus main content (Ctrl+F)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'f' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        // Only prevent default if not in a search input context
        const activeElement = document.activeElement as HTMLElement;
        const isInSearchContext = activeElement?.tagName === 'INPUT' && 
                                  (activeElement as HTMLInputElement).type === 'search';
        
        if (!isInSearchContext) {
          e.preventDefault();
          // Blur any focused element and focus the main content area
          if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
          }
          mainContentRef.current?.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Shift is now handled purely via CSS using peer state and CSS variables.

  return (
    <>
      <AppSidebar className="fixed md:relative h-full md:h-auto" />
      <SidebarInset
        className="max-w-full overflow-hidden"
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
        
        <header className="flex h-16 shrink-0 items-center gap-2 border-b mb-2 px-4 relative z-10">
          <SidebarTrigger className="-ml-1" />
          <div className="h-4 w-[1px] mx-2 bg-border" />
          <div className="flex-1 min-w-0">
            <Breadcrumb>
              <BreadcrumbList className="flex-wrap">
                {breadcrumbs.map((item, idx) => (
                  <span key={item.href} className="flex items-center">
                    <BreadcrumbItem>
                      <BreadcrumbLink href={item.href}>{item.label}</BreadcrumbLink>
                    </BreadcrumbItem>
                    {idx < breadcrumbs.length - 1 && <BreadcrumbSeparator />}
                  </span>
                ))}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-500 rounded-md flex-shrink-0">
            <Link 
              href="https://docs.open-politics.org" 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-blue-700 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200 transition-colors font-medium"
            >
              <span className="text-sm">📚 Check out our updated docs</span>
              <ExternalLink className="h-3 w-3" />
            </Link>
            <span className="text-blue-400">•</span>
            <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-2 py-0.5 rounded-full font-semibold">
              v0.9.9
            </span>
          </div>
        </header>
        
        {/* Mobile Info Banner */}
        {isMobile && !isMobileBannerDismissed && (
          <div className="sm:hidden mx-4 mb-2 relative">
            <div className="flex items-center justify-between gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-500 rounded-md">
              <Link 
                href="https://docs.open-politics.org" 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-blue-700 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200 transition-colors font-medium flex-1 min-w-0"
              >
                <span className="text-xs truncate">📚 Updated docs</span>
                <ExternalLink className="h-3 w-3 flex-shrink-0" />
              </Link>
              <span className="text-blue-400 text-xs">•</span>
              <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0">
                v0.9.9
              </span>
              <button
                onClick={() => setIsMobileBannerDismissed(true)}
                className="ml-1 p-0.5 text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-200 transition-colors flex-shrink-0"
                aria-label="Dismiss banner"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}
        <main 
          ref={mainContentRef}
          className="flex-1 h-full overflow-y-auto relative z-10 focus:outline-none" 
          tabIndex={-1}
        >
          {children}
        </main>
      </SidebarInset>
    </>
  );
}

export default function HQLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading, isLoggedIn, isLoggingOut } = useAuth();  
  const activeInfospace = useInfospaceStore.getState().activeInfospace;
  const router = useRouter();
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (isClient && !isLoading && !isLoggedIn) {
      router.push('/accounts/login');
    }
  }, [isClient, isLoading, isLoggedIn, router]);
  
  if (!isClient || isLoading || isLoggingOut) {
    return (
      <div className="h-screen w-full flex justify-center items-center">
        <LottiePlaceholder />
      </div>
    )
  }

  if (!isLoggedIn) {
    return (
      <div className="h-screen w-full flex justify-center items-center">
        <LottiePlaceholder />
      </div>
    )
  }

  return (
    <div className="h-full max-h-screen w-full flex flex-col md:flex-row overflow-hidden">
      <SidebarContent user={user}>
        {children}
      </SidebarContent>
    </div>
  )
}