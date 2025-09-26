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
  Search,
  DoorOpen,
  GithubIcon,
  Asterisk,
  Activity
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
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu
} from "@/components/ui/sidebar"
import HistoryList from "@/components/ui/SearchHistory"
import ModeSwitcher from "@/components/ui/mode-switcher"


export const InfospaceItems = [
  {
    title: "Infospace Manager",
    url: "/hq/infospaces/Infospace-manager",
    icon: FolderCog,
  },
];

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {}

export function AppSidebar({ ...props }: AppSidebarProps) {
  const { user, isLoading } = useAuth()


  const links = [
    {
      title: "Landing Page",
      url: "/",
      icon: Asterisk,
    },
    {
      title: "documentation",
      url: "https://docs.open-politics.org",
      icon: BookOpen,
    },
    {
      title: "Forum",
      url: "https://forum.open-politics.org",
      icon: MessageSquare,
    },
    {
      title: "GitHub",
      url: "https://github.com/open-politics",
      icon: GithubIcon,
    }
  ]
  
  const navMain = React.useMemo(() => [
    {
      title: "Home",
      url: "/hq",
      icon: Home,
      isActive: true,
    },
    // {
    //   title: "OPOL Globe",
    //   url: "/hq/globe",
    //   icon: Globe,
    //   isActive: true,
    // },
    {
    title: "Schemas",
    url: "/hq/infospaces/annotation-schemes",
      icon: Microscope,
      isActive: true,
    },
    {
      title: "Assets",
      url: "/hq/infospaces/asset-manager",
      icon: FileText,
      isActive: true,
    },
    {
      title: "Analysis Runner",
      url: "/hq/infospaces/annotation-runner",
      icon: SquareTerminal,
      isActive: true,
    },
    {
      title: "Monitors",
      url: "/hq/infospaces/monitors",
      icon: Activity,
      isActive: true,
    },
    {
      title: "Chat",
      url: "/hq/chat",
      icon: Bot,
      isActive: true,
    }
    // {
    //   title: "Content Search",
    //   url: "/hq/infospaces/content-search",
    //   icon: Search,
    //   isActive: true,
    // },
    // {
    //   title: "Datasets",
    //   url: "/hq/infospaces/dataset-manager",
    //   icon: Database,
    //   isActive: false,
    // },
  ], [])
  
  const settingsNav = React.useMemo(() => [
    {
      title: "Infospace Settings",
      url: "/hq/infospaces/infospace-manager",
      icon: FolderCog,
      isActive: true,
    }
  ], [])
  
  const projects = React.useMemo(() => [
  ], [])

  return (
    <Sidebar collapsible="icon" variant="floating" {...props} className="">
      <SidebarHeader>
        <InfospaceSwitcher />
      </SidebarHeader>
      <SidebarContent className="flex flex-col">
        <NavMain title="Navigation" items={navMain} />
        {/* {user?.is_superuser && (
          <NavProjects projects={projects} />
        )} */}
        <SidebarGroup className="mt-auto">
          <SidebarGroupLabel>Links</SidebarGroupLabel>
          <SidebarMenu>
            {links.map((link) => (
              <SidebarMenuItem key={link.title}>
                <SidebarMenuButton asChild tooltip={link.title}>
                  <Link href={link.url}>
                    <link.icon />
                    <span>{link.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
            
          </SidebarMenu>
          <SidebarMenu className="mt-2">
            <SidebarGroupLabel>Theme</SidebarGroupLabel>
            <SidebarMenuItem>
              <ModeSwitcher />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
        <NavMain title="Settings" items={settingsNav} />
         {/* <HistoryList userId={user?.id} /> */}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={{ 
          name: user?.full_name || "User", 
          email: user?.email || "user@example.com", 
          avatar: user?.avatar || undefined,
          is_superuser: user?.is_superuser || false,
          full_name: user?.full_name || "User",
          profile_picture_url: user?.profile_picture_url || undefined,
           }} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

export default AppSidebar

