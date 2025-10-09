"use client"

import * as React from "react"
import { ChevronsUpDown, Plus, Settings } from "lucide-react"
import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import Link from "next/link"
import useAuth from "@/hooks/useAuth"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { useInfospaceStore } from "@/zustand_stores/storeInfospace"
import { IconRenderer } from "@/components/collection/utilities/icons/icon-picker"
import EditInfospaceOverlay from "@/components/collection/management/EditInfospaceOverlay"

export function InfospaceSwitcher() {
  const { isMobile } = useSidebar()
  const { theme } = useTheme()
  const [isEditOverlayOpen, setIsEditOverlayOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const { user } = useAuth()

  const {
    infospaces,
    activeInfospace,
    setActiveInfospace,
    fetchInfospaces,
    createInfospace
  } = useInfospaceStore()

  useEffect(() => {
    if (!infospaces.length && !useInfospaceStore.getState().activeInfospace) {
      fetchInfospaces()
    }
  }, [infospaces.length, fetchInfospaces])

  // Handle create and switch
  const handleCreateInfospace = async (name: string, description: string, icon: string) => {
    if (!user) {
      // Maybe show a toast message here
      return;
    }
    await createInfospace({
      name,
      description,
      icon,
      owner_id: user.id,
    });
    // The store's logic should handle fetching and setting the new active Infospace
  };

  const handleCloseOverlay = () => {
    setIsEditOverlayOpen(false);
    setIsCreating(false);
  };

  // Keyboard shortcut to open infospace switcher (Ctrl+I)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'i' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setIsDropdownOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Add null guard for initial render
  if (!activeInfospace && infospaces.length > 0) {
    return <div className="h-12 animate-pulse bg-muted rounded-md" />;
  }

  const activeInfospaceData = activeInfospace
    ? {
      name: activeInfospace.name,
      description: activeInfospace.description,
      icon: activeInfospace.icon,
    }
    : undefined;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton 
              size="lg" 
              className="bg-sidebar text-sidebar-foreground group relative"
              tooltip={{
                children: (
                  <div className="flex items-center gap-2">
                    <span>Switch Infospace</span>
                    <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
                      Ctrl+I
                    </kbd>
                  </div>
                ),
              }}
            >
              <div className="flex items-center justify-start w-full gap-1 text-sm leading-tight rounded-lg p-2 pl-1">
                <div className={`flex aspect-square size-6 items-center justify-center rounded-md flex-shrink-0 ${theme === "dark" ? "text-white" : "text-black"}`}>
                  <ChevronsUpDown className="size-4" />
                </div>
                <div className="flex items-center gap-3">
                  {activeInfospace?.icon && (
                    <IconRenderer className="size-5 text-secondary-500 flex-shrink-0" icon={activeInfospace.icon} />
                  )}
                  <span className="truncate font-semibold">
                    {activeInfospace?.name || "Select Infospace"}
                  </span>
                </div>
              </div>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-72 bg-sidebar text-sidebar-foreground border border-sidebar-border rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Infospaces
            </DropdownMenuLabel>
            {infospaces.map((infospace) => (
              <DropdownMenuItem
                key={infospace.id}
                onClick={() => setActiveInfospace(infospace.id)}
                className="gap-2 p-2 flex items-center"
              >
                {infospace.icon && (
                  <IconRenderer className="size-4 text-secondary-500" icon={infospace.icon} />
                )}
                <span>{infospace.name}</span>
                <DropdownMenuShortcut>⌘{infospace.id}</DropdownMenuShortcut>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 p-2" onClick={() => {
              setIsCreating(true);
              setIsEditOverlayOpen(true);
            }}>
              <div className="w-full flex items-center gap-2">
                <div className="flex size-6 items-center justify-center rounded-md bg-sidebar">
                  <Plus className="size-4" />
                </div>
                <div className="font-medium text-muted-foreground">
                  Create & Use New Infospace
                </div>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 p-2">
              <Link href="/hq/infospaces/infospace-manager" className="w-full flex items-center gap-2">
                <div className="flex size-6 items-center justify-center rounded-md bg-sidebar">
                  <Settings className="size-4" />
                </div>
                <div className="font-medium text-muted-foreground">
                  Manage Infospaces
                </div>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5">
              <p className="text-[10px] text-muted-foreground text-center">
                Use <kbd className="px-1 py-0.5 rounded bg-muted text-[9px] font-mono">↑↓</kbd> to navigate • <kbd className="px-1 py-0.5 rounded bg-muted text-[9px] font-mono">⏎</kbd> to select • <kbd className="px-1 py-0.5 rounded bg-muted text-[9px] font-mono">Esc</kbd> to close
              </p>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
      
      {/* Use EditInfospaceOverlay for creating new Infospaces */}
      {isEditOverlayOpen && (
        <EditInfospaceOverlay
          open={isEditOverlayOpen}
          onClose={handleCloseOverlay}
          isCreating={isCreating}
          onCreateInfospace={handleCreateInfospace}
          defaultName={isCreating ? "" : activeInfospaceData?.name || ""}
          defaultDescription={isCreating ? "" : activeInfospaceData?.description || ""}
          defaultIcon={isCreating ? "Boxes" : activeInfospaceData?.icon || "Boxes"}
        />
      )}
    </SidebarMenu>
  )
}

export default InfospaceSwitcher