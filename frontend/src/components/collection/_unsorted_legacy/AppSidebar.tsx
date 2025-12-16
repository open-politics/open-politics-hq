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
  Users,
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
  Workflow,
  Terminal
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
  SidebarSeparator,
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
      title: "Documentation",
      url: "https://docs.open-politics.org",
      icon: BookOpen,
    },
    {
      title: "Forum",
      url: "https://forum.open-politics.org",
      icon: Users,
    },
    {
      title: "GitHub",
      url: "https://github.com/open-politics/open-politics-hq",
      icon: GithubIcon,
    }
  ]

  const toolsNav = React.useMemo(() => [
    {
      title: "Chat",
      url: "/hq/chat",
      icon: MessageSquare,
      isActive: true,
      colorClass: "sidebar-teal",
    },
    {
      title: "Analysis",
      url: "/hq/infospaces/annotation-runner",
      icon: Terminal,
      isActive: true,
      colorClass: "sidebar-blue",
      description: "One-off annotation runs",
    },
    {
      title: "Flows",
      url: "/hq/infospaces/flows",
      icon: Workflow,
      isActive: true,
      colorClass: "sidebar-orange",
      description: "Automated processing pipelines",
    },
  ], [])

  const storesNav = React.useMemo(() => [
    {
      title: "Assets",
      url: "/hq/infospaces/asset-manager",
      icon: FileText,
      isActive: true,
      colorClass: "sidebar-green",
    },
    {
      title: "Schemas",
      url: "/hq/infospaces/annotation-schemes",
      icon: Microscope,
      isActive: true,
      colorClass: "sidebar-sky",
    }
  ], [])
  
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
 
    // },
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
      colorClass: "sidebar-gray",
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
        <NavMain title="Tools" items={toolsNav} />
        <SidebarSeparator />
        <NavMain title="Stores" items={storesNav} />  
        <SidebarSeparator />
        <NavMain title="Settings" items={settingsNav} />
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

