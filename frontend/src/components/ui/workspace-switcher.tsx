"use client"

import * as React from "react"
import { ChevronsUpDown, Plus, Settings } from "lucide-react"
import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import Link from "next/link"

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
import { useWorkspaceStore } from "@/zustand_stores/storeWorkspace"
import { IconRenderer } from "@/components/collection/workspaces/utilities/icons/icon-picker"
import EditWorkSpaceOverlay from "@/components/collection/workspaces/management/EditWorkSpaceOverlay"

export function WorkspaceSwitcher() {
  const { isMobile } = useSidebar()
  const { theme } = useTheme()
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  const {
    workspaces,
    activeWorkspace,
    setActiveWorkspace,
    fetchWorkspaces,
    createWorkspace
  } = useWorkspaceStore()

  useEffect(() => {
    if (!workspaces.length && !useWorkspaceStore.getState().activeWorkspace) {
      fetchWorkspaces()
    }
  }, [workspaces.length, fetchWorkspaces])

  // Handle create and switch
  const handleCreateWorkspace = async (name: string, description: string, icon: string, systemPrompt: string) => {
    try {
      await createWorkspace({
        name,
        description,
        icon,
        system_prompt: systemPrompt,
      });
      // The createWorkspace function in the store already sets the new workspace as active
      setIsCreateDialogOpen(false);
    } catch (error) {
      console.error('Error creating workspace:', error);
    }
  };

  // Add null guard for initial render
  if (!activeWorkspace && workspaces.length > 0) {
    return <div className="h-12 animate-pulse bg-muted rounded-md" />;
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg">
              <div className="flex items-center gap-2 md:gap-4 text-sm leading-tight">
                <div className={`flex aspect-square size-8 items-center justify-center rounded-lg ${theme === "dark" ? "text-white" : "text-black"}`}>
                  <ChevronsUpDown className="size-4" />
                </div>
                {activeWorkspace?.icon && (
                  <IconRenderer className="size-5 text-secondary-500" icon={activeWorkspace.icon} />
                )}
                <span className="truncate font-semibold text-right">
                  {activeWorkspace?.name || "Select Workspace"}
                </span>
                {/* <div className="flex aspect-square size-8 items-center justify-center rounded-lg text-sidebar-primary-foreground ml-auto">
                  <Plus className="size-4" />
                </div> */}
              </div>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-72 border-none rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Workspaces
            </DropdownMenuLabel>
            {workspaces.map((workspace) => (
              <DropdownMenuItem
                key={workspace.id}
                onClick={() => setActiveWorkspace(workspace.id)}
                className="gap-2 p-2 flex items-center"
              >
                {workspace.icon && (
                  <IconRenderer className="size-4 text-secondary-500" icon={workspace.icon} />
                )}
                <span>{workspace.name}</span>
                <DropdownMenuShortcut>⌘{workspace.id}</DropdownMenuShortcut>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 p-2" onClick={() => setIsCreateDialogOpen(true)}>
              <div className="w-full flex items-center gap-2">
                <div className="flex size-6 items-center justify-center rounded-md bg-background">
                  <Plus className="size-4" />
                </div>
                <div className="font-medium text-muted-foreground">
                  Create & Use New Workspace
                </div>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 p-2">
              <Link href="/desks/home/workspaces/workspace-manager" className="w-full flex items-center gap-2">
                <div className="flex size-6 items-center justify-center rounded-md bg-background">
                  <Settings className="size-4" />
                </div>
                <div className="font-medium text-muted-foreground">
                  Manage Workspaces
                </div>
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
      
      {/* Use EditWorkSpaceOverlay for creating new workspaces */}
      <EditWorkSpaceOverlay
        open={isCreateDialogOpen}
        onClose={() => setIsCreateDialogOpen(false)}
        isCreating={true} // Add a prop to indicate we're creating a new workspace
        onCreateWorkspace={handleCreateWorkspace} // Pass the create function (now has correct signature)
      />
    </SidebarMenu>
  )
}

export default WorkspaceSwitcher