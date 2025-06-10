'use client'

import { Globe, MessageSquare, Bookmark, Settings } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar"
import { NavUser } from "@/components/ui/nav-user"
import useAuth from "@/hooks/useAuth"

const mainNavItems = [
  {
    title: "Globe View",
    icon: Globe,
    url: "/desks/home/globe",
  },
  {
    title: "Chat",
    icon: MessageSquare,
    url: "/desks/chat",
  },
  {
    title: "Bookmarks",
    icon: Bookmark,
    url: "/desks/bookmarks",
  },
  {
    title: "Settings",
    icon: Settings,
    url: "/desks/settings",
  },
]

export function DeskSidebar() {
  const { user } = useAuth()

  return (
    <Sidebar 
      variant="inset" 
      className="w-64 flex-none h-full border-r bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
    >
      <SidebarHeader className="h-16 flex items-center px-4 border-b">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <a href="/desks" className="flex items-center space-x-2">
                <span className="font-semibold">Open Politics</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      
      <SidebarContent className="flex-1 px-4 py-2">
        <SidebarMenu>
          {mainNavItems.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton asChild className="flex items-center space-x-2 w-full">
                <a href={item.url}>
                  <item.icon className="h-4 w-4" />
                  <span>{item.title}</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter className="border-t p-4">
        {user && (
          <NavUser user={{
            name: user.full_name || 'User',
            email: user.email || '',
            avatar: user.avatar || '',
            is_superuser: user.is_superuser || false,
            full_name: user.full_name || 'User'
          }} />
        )}
      </SidebarFooter>
    </Sidebar>
  )
}