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
  ArrowRightToLine,
  Database,
  Search
} from "lucide-react"

import { NavMain } from "@/components/ui/nav-main"
import { NavProjects } from "@/components/ui/nav-projects"
import { Separator } from "@/components/ui/separator"
import { NavUser } from "@/components/ui/nav-user"
import InfospaceSwitcher from "@/components/ui/infospace-switcher"
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


export const InfospaceItems = [
  {
    title: "Infospace Manager",
    url: "/desks/home/infospaces/Infospace-manager",
    icon: FolderCog,
  },
];

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {}

export function AppSidebar({ ...props }: AppSidebarProps) {
  const { user, isLoading } = useAuth()
  
  const navMain = React.useMemo(() => [
    {
      title: "Home",
      url: "/desks/home",
      icon: Home,
      isActive: true,
    },
    {
      title: "OPOL Globe",
      url: "/desks/home/globe",
      icon: Globe,
      isActive: true,
    },
    {
    title: "Classifiers",
    url: "/desks/home/infospaces/annotation-schemes",
      icon: Microscope,
      isActive: true,
    },
    {
      title: "Assets",
      url: "/desks/home/infospaces/asset-manager",
      icon: FileText,
      isActive: true,
    },
    {
      title: "Analysis Runner",
      url: "/desks/home/infospaces/annotation-runner",
      icon: SquareTerminal,
      isActive: true,
    },
    {
      title: "Content Search",
      url: "/desks/home/infospaces/content-search",
      icon: Search,
      isActive: true,
    },
    {
      title: "Datasets",
      url: "/desks/home/infospaces/dataset-manager",
      icon: Database,
      isActive: false,
    },
    {
      title: "Information Space Config",
      url: "/desks/home/infospaces/infospace-manager",
      icon: FolderCog,
      isActive: true,
    }
  ], [])
  
  const projects = React.useMemo(() => [
  ], [])

  return (
    <Sidebar collapsible="icon" variant="floating" {...props} className="pt-16">
      <SidebarHeader>
        <InfospaceSwitcher />
      </SidebarHeader>
      <NavMain items={navMain} />
      {/* {user?.is_superuser && (
        <NavProjects projects={projects} />
      )} */}
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
