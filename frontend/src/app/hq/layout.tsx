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
import { ArrowLeft, Menu as MenuIcon } from "lucide-react"
import { useEffect, useState, useRef } from 'react';
// import createGlobe from "cobe";
import { useTheme } from "next-themes"; 
import { useRouter, usePathname } from "next/navigation";

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
        
        <header className="flex h-12 shrink-0 items-center gap-2 px-3 relative z-10">
          <div className="flex items-center gap-0">
            <SidebarTrigger className="size-4 mt-5 border-r border-border/50" />
            <Breadcrumb className="mt-4.5 ml-12 pr-6">
              <BreadcrumbList>
                {breadcrumbs.map((item, idx) => (
                  <span key={item.href} className="flex font-medium items-center">
                    <BreadcrumbItem>
                      <BreadcrumbLink className="" href={item.href}>{item.label}</BreadcrumbLink>
                    </BreadcrumbItem>
                    {idx < breadcrumbs.length - 1 && <BreadcrumbSeparator />}
                  </span>
                ))}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>
        <main className="flex-1 h-full overflow-hidden relative z-10">
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
    return <LottiePlaceholder />
  }

  if (!isLoggedIn) {
    return <LottiePlaceholder />
  }

  return (
    <div className="h-full max-h-screen w-full flex flex-col md:flex-row overflow-hidden">
      <SidebarContent user={user}>
        {children}
      </SidebarContent>
    </div>
  )
}