'use client'

import { Sidebar, SidebarContent, SidebarHeader, SidebarFooter, SidebarMenu, SidebarMenuItem, SidebarMenuButton } from "@/components/ui/sidebar"
import Link from "next/link"

const docs = [
  {
    title: "Documentation 1",
    url: "/docs/doc1",
  },
  {
    title: "Documentation 2",
    url: "/docs/doc2",
  },
  {
    title: "Documentation 3",
    url: "/docs/doc3",
  },
]

export function DocsSidebar() {
  return (
    <Sidebar 
      variant="floating" 
      className="bg-transparent"
    >
      <SidebarHeader className="h-16 flex items-center px-4 border-b">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/docs" className="flex items-center space-x-2">
                <span className="font-semibold">Public Docs</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      
      <SidebarContent className="flex-1 px-4 py-2">
        <SidebarMenu>
          {docs.map((doc) => (
            <SidebarMenuItem key={doc.title}>
              <SidebarMenuButton asChild className="flex items-center space-x-2 w-full">
                <Link href={doc.url}>
                  <span>{doc.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter className="border-t p-4">
        {/* Optional footer content */}
      </SidebarFooter>
    </Sidebar>
  )
}