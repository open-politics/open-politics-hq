'use client'

import { SidebarInset, SidebarTrigger, useSidebar } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/collection/_unsorted_legacy/AppSidebar"
import { TopbarSlotProvider, TopbarSlotRenderer } from "@/components/layout/TopbarSlot"
import { DefaultTopbar } from "@/components/layout/DefaultTopbar"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable"
import LottiePlaceholder from "@/components/ui/lottie-placeholder"
import useAuth from "@/hooks/useAuth"
import { useInfospaceStore } from "@/zustand_stores/storeInfospace"
import { useUserPreferencesStore } from "@/zustand_stores/storeUserPreferences"
import { useIsMobile } from "@/hooks/use-mobile"
import { useDock } from "@/zustand_stores/storeDock"
import { useAnnotationRunStore } from "@/zustand_stores/useAnnotationRunStore"
import { DockHost } from "@/components/collection/intake/DockHost"
import { CommandRegistryBridge } from "@/components/collection/chat/directives/CommandRegistryBridge"
import { ActiveObservations } from "@/components/collection/chat/observe/ActiveObservations"
import { OperatorCompanion } from "@/components/collection/chat/OperatorCompanion"
import { TextSpanHighlightProvider } from "@/components/collection/contexts/TextSpanHighlightContext"
import { ArrowLeft, Menu as MenuIcon, ExternalLink, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useEffect, useState, useRef } from 'react';
import { useRouter } from "next/navigation";
import Link from "next/link";

// Main content + the global right dock. Desktop: a resizable split; mobile: a
// sheet; fullscreen: the dock lifts over the whole content area. Driven entirely
// by the dock store, so any route can summon detail / discover / source editing.
function MainContentWithInspector({
  children,
  mainContentRef,
}: {
  children: React.ReactNode;
  mainContentRef: React.RefObject<HTMLDivElement | null>;
}) {
  const isMobile = useIsMobile();
  // A page hosting the dock inline (AssetManager's third column on desktop) stands
  // the app-wide dock down so the same content isn't rendered twice.
  const inlineHosted = useDock((s) => s.inlineHostCount > 0);
  const isOpen = useDock((s) => s.entry !== null) && !inlineHosted;
  const close = useDock((s) => s.close);

  if (isMobile) {
    return (
      <>
        <main
          ref={mainContentRef}
          className="relative z-10 flex h-full min-h-0 flex-1 flex-col overflow-hidden focus:outline-none @container"
          tabIndex={-1}
        >
          {children}
        </main>
        <Sheet open={isOpen} onOpenChange={(open) => !open && close()}>
          <SheetContent side="right" className="flex h-full w-[92vw] flex-col p-0 sm:w-[420px]">
            <SheetHeader className="sr-only">
              <SheetTitle>Dock</SheetTitle>
              <SheetDescription>Summoned detail and tools</SheetDescription>
            </SheetHeader>
            <DockHost />
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <>
      <ResizablePanelGroup
        direction="horizontal"
        className="relative z-10 flex h-full min-h-0 flex-1"
        autoSaveId={null}
      >
        <ResizablePanel
          defaultSize={isOpen ? 50 : 100}
          minSize={30}
          className="min-h-0 overflow-hidden"
        >
          <main
            ref={mainContentRef}
            className="h-full min-h-0 overflow-y-auto focus:outline-none @container"
            tabIndex={-1}
          >
            {children}
          </main>
        </ResizablePanel>

        {isOpen && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={50} minSize={24} maxSize={75} className="min-h-0 overflow-hidden">
              <DockHost />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </>
  );
}

// Component that uses the sidebar context
function SidebarContent({ children, user }: { children: React.ReactNode, user: any }) {
  const { isMobile: sidebarMobile } = useSidebar();
  const mainContentRef = useRef<HTMLDivElement>(null);
  // Focus mode (annotation runner) hides all chrome for a clean canvas — that
  // includes this app-level top bar. The runner clears the flag on unmount so
  // it never leaks onto other routes.
  const focusMode = useAnnotationRunStore((s) => s.focusMode);

  // User preferences
  const { preferences, initializePreferences, updatePreference } = useUserPreferencesStore();
  // When a custom background image is set, the main content surface goes frosted
  // (translucent + blurred) so the wallpaper rendered behind the app by
  // <BackgroundImage> shows through. The sidebar and cards keep their own solid
  // surfaces, so text stays readable. Without a custom background the inset keeps
  // its default opaque `bg-background`.
  const hasCustomBackground = !!(
    preferences.custom_background_url ||
    preferences.custom_background_url_light ||
    preferences.custom_background_url_dark
  );

  // Bootstrap infospaces once at the layout level (which is always mounted),
  // not from the sidebar — on mobile the sidebar lives inside a Radix <Sheet>
  // whose content doesn't mount until the user opens it, so the
  // <InfospaceSwitcher>'s `fetchInfospaces()` effect never fires until then.
  // Pages that auto-load on `activeInfospace?.id` (annotation runner, etc.)
  // would otherwise stay empty until the user manually opens the sidebar.
  // Same guard as the switcher (skip if already populated) so this stays
  // a single fetch.
  useEffect(() => {
    const { infospaces, activeInfospace, fetchInfospaces } = useInfospaceStore.getState();
    if (infospaces.length === 0 && !activeInfospace) {
      fetchInfospaces();
    }
  }, []);

  // Initialize preferences from user data
  useEffect(() => {
    if (user?.ui_preferences) {
      initializePreferences(user.ui_preferences);
    }
  }, [user, initializePreferences]);

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

  return (
    <TopbarSlotProvider>
      <AppSidebar className="fixed md:relative h-full md:h-auto" />
      <SidebarInset
        className={cn(
          "max-w-full overflow-hidden",
          hasCustomBackground && "bg-transparent backdrop-blur-sm"
        )}
      >
        {!focusMode && (
        <header className="flex h-16 shrink-0 items-center gap-2 border-b mb-1 px-4 relative z-10">
          <SidebarTrigger className="-ml-1" />
          <div className="h-4 w-[1px] mx-2 bg-border" />
          <div className="flex-1 min-w-0 flex items-center gap-2">
            <TopbarSlotRenderer fallback={<DefaultTopbar />} />
          </div>
        </header>
        )}

        {/* Mobile Info Banner */}
        {sidebarMobile && !preferences.docs_banner_dismissed && (
          <div className="sm:hidden mx-3 mb-2 relative">
            <div className="flex items-center justify-between gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-500 rounded-md">
              <Link 
                href="https://docs.open-politics.org/pages/app/overview" 
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
                onClick={() => updatePreference('docs_banner_dismissed', true)}
                className="ml-1 p-0.5 text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-200 transition-colors flex-shrink-0"
                aria-label="Dismiss banner"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}
        <MainContentWithInspector mainContentRef={mainContentRef}>
          {children}
        </MainContentWithInspector>
      </SidebarInset>
    </TopbarSlotProvider>
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
    <TextSpanHighlightProvider>
      <div className="h-full max-h-screen w-full flex flex-col md:flex-row overflow-hidden">
        <CommandRegistryBridge />
        <ActiveObservations />
        <OperatorCompanion />
        <SidebarContent user={user}>
          {children}
        </SidebarContent>
      </div>
    </TextSpanHighlightProvider>
  )
}