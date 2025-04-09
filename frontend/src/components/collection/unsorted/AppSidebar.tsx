"use client"

import * as React from "react"
import Link from "next/link"
import {
  AudioWaveform,
  BookOpen,
  Bot,
  Command,
  Frame,
  GalleryVerticalEnd,
  Home,
  PieChart,
  Microscope,
  Settings2,
  SquareTerminal,
  Globe,
  Bookmark,
  Clipboard,
  FileText,
  LayoutDashboard,
  Send,
  Swords,
  Orbit,
  ShieldAlert,
  Blocks,
  Globe2,
  MessageSquare,
  FolderCog,
  ChevronLeft,
  ChevronRight,
  ArrowLeftToLine,
  ArrowRightToLine
} from "lucide-react"

import { NavMain } from "@/components/ui/nav-main"
import { NavProjects } from "@/components/ui/nav-projects"
import { Separator } from "@/components/ui/separator"
import { NavUser } from "@/components/ui/nav-user"
import WorkspaceSwitcher from "@/components/ui/workspace-switcher"
import useAuth from "@/hooks/useAuth"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  SidebarTrigger
} from "@/components/ui/sidebar"
import HistoryList from "@/components/ui/SearchHistory"


export const workspaceItems = [
  {
    title: "Workspace Manager",
    url: "/desks/home/workspaces/workspace-manager",
    icon: FolderCog,
  },
];

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {}

export function AppSidebar({ ...props }: AppSidebarProps) {
  const { user, isLoading } = useAuth()
  
  const navMain = React.useMemo(() => [
    {
      title: "Tools",
      url: "/desks/home/",
      icon: Blocks,
      isActive: true,
      items: [
        {
          title: "Overview",
          url: "/desks/home",
          icon: Home,
        },
        {
          title: "Globe",
          url: "/desks/home/globe",
          icon: Globe,
        },
        {
        title: "Schemes",
        url: "/desks/home/workspaces/classification-schemes",
          icon: Microscope,
        },
        {
          title: "Documents",
          url: "/desks/home/workspaces/document-manager",
          icon: FileText,
        },
        {
          title: "Analyser",
          url: "/desks/home/workspaces/classification-runner",
          icon: SquareTerminal,
        },
        // {
        //   title: "Chat",
        //   url: "/desks/home/chat",
        //   icon: MessageSquare,
        // },
      ],
    },
    {
      title: "Workspace",
      url: "#",
      icon: FolderCog,
      items: workspaceItems,
    },
  ], [])
  
  const projects = React.useMemo(() => [
    {
      name: "workspaces",
      url: "/desks/home/workspaces",
      icon: FolderCog,
    }
  ], [])

  return (
    <Sidebar collapsible="icon" variant="floating" {...props} className="pt-16">
      <SidebarHeader>
        <WorkspaceSwitcher />
      </SidebarHeader>
      <NavMain items={navMain} />
      {user?.is_superuser && (
        <NavProjects projects={projects} />
      )}
      <SidebarContent>
         {/* <HistoryList userId={user?.id} /> */}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={{ 
          name: user?.full_name || "User", 
          email: user?.email || "user@example.com", 
          avatar: user?.avatar || undefined,
          is_superuser: user?.is_superuser || false,
          full_name: user?.full_name || "User"
           }} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

export default AppSidebar
