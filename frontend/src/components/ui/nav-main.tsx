"use client"

import { ChevronRight, type LucideIcon } from "lucide-react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"

export function NavMain({
  items,
  title,
}: {
  title?: string
  items: {
    title: string
    url: string
    icon?: LucideIcon
    isButton?: boolean
    isActive?: boolean
    colorClass?: string
    items?: {
      title: string
      url: string
      onClick?: () => void
      icon?: LucideIcon
    }[]
  }[]
}) {
  // Map colorClass to colorVariant
  const getColorVariant = (colorClass?: string): "default" | "blue" | "teal" | "pink" | "green" | "sky" | "gray" => {
    if (!colorClass) return "default";
    if (colorClass.includes("blue")) return "blue";
    if (colorClass.includes("teal")) return "teal";
    if (colorClass.includes("pink")) return "pink";
    if (colorClass.includes("green")) return "green";
    if (colorClass.includes("sky")) return "sky";
    if (colorClass.includes("gray")) return "gray";
    return "default";
  };
  return (
    <SidebarGroup className="p-2">
      <SidebarGroupLabel>{title ? title : "Navigation"}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) =>
          item.items && item.items.length > 0 ? (
            <Collapsible
              key={item.title}
              asChild
              defaultOpen={item.isActive}
              className="group/collapsible"
            >
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton tooltip={item.title} colorVariant={getColorVariant(item.colorClass)}>
                    {item.icon && <item.icon />}
                    <span>{item.title}</span>
                    <ChevronRight className="ml-auto transition-transform border-none duration-200 group-data-[state=open]/collapsible:rotate-90" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {item.items?.map((subItem) => (
                      <SidebarMenuSubItem key={subItem.title}>
                        {item.isButton ? (
                          <SidebarMenuSubButton
                            size="sm"
                            className="pl-8"
                            onClick={subItem.onClick}
                          >
                            {subItem.icon && <subItem.icon className="size-4" />}
                            <span>{subItem.title}</span>
                          </SidebarMenuSubButton>
                        ) : (
                          <SidebarMenuSubButton
                            asChild
                            size="sm"
                            className="pl-8"
                          >
                            <a href={subItem.url}>
                              {subItem.icon && <subItem.icon className="size-4" />}
                              <span>{subItem.title}</span>
                            </a>
                          </SidebarMenuSubButton>
                        )}
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          ) : (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                asChild
                isActive={item.isActive}
                tooltip={item.title}
                colorVariant={getColorVariant(item.colorClass)}
              >
                <a href={item.url}>
                  {item.icon && <item.icon />}
                  <span>{item.title}</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )
        )}
      </SidebarMenu>
    </SidebarGroup>
  )
}

export default NavMain;