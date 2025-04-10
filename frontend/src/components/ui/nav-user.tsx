'use client'

import { LogOut, User, Settings, Shield, FolderCog } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import useAuth from "@/hooks/useAuth"
import { useState, useEffect } from 'react'
import Link from "next/link"

export interface NavUserProps {
  user: {
    name: string | undefined;
    email: string | undefined;
    avatar: string | undefined;
    is_superuser: boolean | undefined;
    full_name: string | undefined;
  };
}

export function NavUser({ user }: NavUserProps) {
  const { isMobile } = useSidebar()
  const { logout } = useAuth()
  const [opacity, setOpacity] = useState(1)

  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY
      const maxScroll = 50 // Adjust this value as needed
      const newOpacity = Math.max(1 - scrollY / maxScroll, 0)
      setOpacity(newOpacity)
    }

    window.addEventListener('scroll', handleScroll)
    return () => {
      window.removeEventListener('scroll', handleScroll)
    }
  }, [])

  return (
    <SidebarMenu className="border-none">
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg">
              <Avatar className="h-8 w-8">
                <AvatarImage src={user?.avatar} alt={user?.name} />
                <AvatarFallback>
                  {user?.name?.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span
                  className="truncate font-semibold transition-opacity duration-300"
                  style={{ opacity }}
                >
                  {user?.name}
                </span>
                <span className="truncatetransition-opacity duration-300" style={{ opacity }}>
                  {user?.email?.split('@')[0]}@...
                </span>
              </div>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent 
            className="w-56" 
            side={isMobile ? "bottom" : "right"}
            align="end"
          >
            <DropdownMenuLabel>My Account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <Link href="/accounts/settings">
                  <User className="mr-2 h-4 w-4" />
                  <span>Account Settings</span>
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout}>
              <LogOut className="mr-2 h-4 w-4" />
              <span>Log out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}