'use client'

import { SidebarInset, useSidebar } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/collection/_unsorted_legacy/AppSidebar"
import { BottomRail } from "@/components/layout/BottomRail"
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
import { useEffect, useState, useRef, type CSSProperties } from 'react';
import { usePathname, useRouter } from "next/navigation";
import { usePushIntent } from "@/hooks/usePushIntent";
import { useChatStrip } from "@/hooks/useChatStrip";
import { useChatStore } from "@/zustand_stores/storeChat";
import Link from "next/link";

// Main content + the global right dock. The dock is a resizable split beside
// the content on a wide screen and a sheet over it on a narrow one, driven
// entirely by the dock store so any route can summon detail / discover /
// source editing.
//
// The shape below matters more than it looks. This used to be two whole trees
// behind `if (isMobile)`, and `children` — the entire page — sat at a different
// depth in each. `useIsMobile` cannot know the viewport until after it mounts,
// so on a phone React built the desktop tree, ran every page effect, then threw
// it away and built the mobile one: a visible flash, all page state lost, and
// every mount-time fetch issued twice on every navigation.
//
// Now the group, the first panel and `<main>` are unconditional, so `children`
// occupies one stable position and never remounts. Only the dock's presentation
// forks, and the dock is usually closed on arrival.
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

  // Split beside the content only when there is room for two columns.
  const splitDock = isOpen && !isMobile;

  return (
    <>
      <ResizablePanelGroup
        direction="horizontal"
        className="relative z-10 flex min-h-0 flex-1"
        autoSaveId={null}
      >
        <ResizablePanel
          defaultSize={splitDock ? 50 : 100}
          minSize={30}
          className="min-h-0 overflow-hidden"
        >
          <main
            ref={mainContentRef}
            className="flex h-full min-h-0 flex-col overflow-hidden focus:outline-none @container"
            tabIndex={-1}
          >
            {children}
          </main>
        </ResizablePanel>

        {splitDock && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={50} minSize={24} maxSize={75} className="min-h-0 overflow-hidden">
              <DockHost />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>

      {/* Narrow: the same dock, over the content instead of beside it. Rendered
          as a sibling of the group rather than inside it, so toggling between
          the two presentations never disturbs the panel that holds the page. */}
      {isMobile && (
        <Sheet open={isOpen} onOpenChange={(open) => !open && close()}>
          <SheetContent side="right" className="flex h-full w-[92vw] flex-col p-0 pb-safe sm:w-[420px]">
            <SheetHeader className="sr-only">
              <SheetTitle>Dock</SheetTitle>
              <SheetDescription>Summoned detail and tools</SheetDescription>
            </SheetHeader>
            <DockHost />
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}

// Component that uses the sidebar context
function SidebarContent({ children, user }: { children: React.ReactNode, user: any }) {
  const { isMobile: sidebarMobile } = useSidebar();
  const mainContentRef = useRef<HTMLDivElement>(null);

  // Focus mode (annotation runner) hides all chrome for a clean canvas — the
  // navigation bar and the rail. The runner clears the flag on unmount so it
  // never leaks onto other routes.
  const focusMode = useAnnotationRunStore((s) => s.focusMode);

  // The shell is a vertical sequence — navigation bar, content, chat drawer —
  // and scrolling moves along it, past the content's own scroll:
  //  - push down anywhere and the bar slides away;
  //  - push up past the top of the content, against some resistance, and it
  //    comes back from its own place;
  //  - keep pushing down past the end of the content — the same swipe can
  //    carry on once the bar has gone — and the chat comes up with the hand,
  //    the page moving up with it, and settles at whichever end is nearer
  //    when you let go (`useChatStrip`).
  // The bar snaps; it is a few pixels of chrome. The chat is a place, so it
  // is moved to rather than summoned. A new route brings the bar back,
  // because arriving somewhere is exactly when you want to see where you are.
  const insetRef = useRef<HTMLDivElement>(null);
  const [barAway, setBarAway] = useState(false);
  const pathname = usePathname();
  const drawerOpen = useChatStore((s) => s.drawerOpen);
  usePushIntent(insetRef, {
    direction: "down",
    travel: 48,
    enabled: !barAway,
    onPush: () => setBarAway(true),
  });
  usePushIntent(insetRef, {
    direction: "up",
    travel: 160,
    pastEdge: true,
    enabled: barAway,
    onPush: () => setBarAway(false),
  });
  // Past the end of the page, the chat — followed by hand, not triggered.
  // The bar goes first: the chat is the far end of the sequence. Focus mode
  // has no bar, the chat page is the chat already, and the small window has
  // the chat in hand.
  const chatPlacement = useChatStore((s) => s.placement);
  useChatStrip(insetRef, {
    canOpen: (barAway || focusMode) && chatPlacement !== "open" && pathname !== "/hq/chat",
    // However a pull starts, the bar is behind you once it has.
    onPull: () => setBarAway(true),
  });
  // However the drawer was opened, the bar is already behind you by then.
  useEffect(() => {
    if (drawerOpen) setBarAway(true);
  }, [drawerOpen]);
  useEffect(() => setBarAway(false), [pathname]);

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
    <>
      {/* Navigation runs across the top. Focus mode takes it too: the runner's
          exit-focus control sits in the top-right corner, where the bar's
          account menu would otherwise be underneath it. */}
      {/* Collapsed by `grid-template-rows` rather than a measured height, so
          the bar can be any height (expanded, icon strip) and still animate
          to nothing. `invisible` lands when the slide ends and takes the bar
          out of the tab order while it is away. */}
      {!focusMode && (
        <div
          className={cn(
            "grid shrink-0 transition-[grid-template-rows,opacity,visibility] duration-200 ease-out",
            barAway ? "invisible grid-rows-[0fr] opacity-0" : "grid-rows-[1fr]"
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <AppSidebar side="top" />
          </div>
        </div>
      )}
      <SidebarInset
        ref={insetRef}
        className={cn(
          "min-h-0 max-w-full overflow-hidden",
          hasCustomBackground && "bg-transparent backdrop-blur-sm",
          drawerOpen && "pointer-events-none"
        )}
        // The strip's upper card: a gap all round on a desktop, and pulled up
        // it slides up with the chat. (See `--chat-pull` in globals.css.)
        data-chat-strip="page"
        data-bar-away={barAway || focusMode || undefined}
        style={{ "--chat-pull": drawerOpen ? 1 : 0 } as CSSProperties}
      >
        {/* Mobile Info Banner */}
        {sidebarMobile && !preferences.docs_banner_dismissed && (
          <div className="relative mx-3 mb-2 flex-none sm:hidden">
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

        {/* In the column, not over it: the content region above is `flex-1
            min-h-0`, so it gives up exactly the rail's height and no page has
            to know the rail is there. */}
        {!focusMode && <BottomRail />}
      </SidebarInset>
    </>
  );
}

export default function HQLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading, isLoggedIn, isLoggingOut } = useAuth();
  // Focus mode strips every piece of chrome, the rail included — so the
  // reservation it publishes has to go to zero with it.
  const focusMode = useAnnotationRunStore((s) => s.focusMode);
  // The canvas the page and the chat sit on shows between them; a wallpaper,
  // when there is one, is that canvas.
  const wallpaper = useUserPreferencesStore((s) => !!(
    s.preferences.custom_background_url ||
    s.preferences.custom_background_url_light ||
    s.preferences.custom_background_url_dark
  ));
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
      <div className="h-dvh w-full flex justify-center items-center">
        <LottiePlaceholder />
      </div>
    )
  }

  if (!isLoggedIn) {
    return (
      <div className="h-dvh w-full flex justify-center items-center">
        <LottiePlaceholder />
      </div>
    )
  }

  return (
    <TextSpanHighlightProvider>
      {/* The one element in the app that names a viewport unit. `dvh` is the
          dynamic viewport: it tracks the mobile URL bar as it hides and shows,
          where the `100vh` this replaces always reported the tallest state and
          left the bottom of the app permanently underneath browser chrome.
          Everything below sizes with `h-full` / `flex-1 min-h-0` against this. */}
      <div
        data-app-shell
        data-rail={focusMode ? 'off' : 'on'}
        className={cn("h-dvh w-full flex flex-col overflow-hidden", !wallpaper && "bg-[var(--strip-canvas)]")}
      >
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