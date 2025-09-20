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
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
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
    profile_picture_url: string | undefined;
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
            <SidebarMenuButton size="lg" className="bg-sidebar text-sidebar-foreground">
              <Avatar className="h-8 w-8">
                <AvatarImage src={user?.profile_picture_url} alt={user?.name} />
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
            className="w-64 bg-sidebar text-sidebar-foreground border border-sidebar-border"
            side={isMobile ? "bottom" : "right"}
            align="end"
          >
            <DropdownMenuLabel>My Account</DropdownMenuLabel>
            <DropdownMenuSeparator />

            <DropdownMenuGroup>
              {/* On mobile, flatten the menu structure to avoid sub-menu positioning issues */}
              {isMobile ? (
                <>
                  {/* Account Settings - Direct Links on Mobile */}
                  <DropdownMenuItem asChild>
                    <Link href="/accounts/settings" className="font-medium">
                      <User className="mr-2 h-4 w-4" />
                      <span>Account Settings</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/accounts/settings#profile" className="pl-6">
                      <span>Profile</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/accounts/settings#password" className="pl-6">
                      <span>Change Password</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/accounts/settings#delete" className="pl-6">
                      <span>Delete Account</span>
                    </Link>
                  </DropdownMenuItem>

                  {user?.is_superuser && (
                    <>
                      <DropdownMenuSeparator />
                      {/* Admin Settings - Direct Links on Mobile */}
                      <DropdownMenuItem asChild>
                        <Link href="/accounts/admin/users" className="font-medium">
                          <Shield className="mr-2 h-4 w-4" />
                          <span>Admin Settings</span>
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/accounts/admin/users" className="pl-6">
                          <span>User Management</span>
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/accounts/admin/backups" className="pl-6">
                          <span>Infospace Backups</span>
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/accounts/admin/user-backups" className="pl-6">
                          <span>User Backups</span>
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/accounts/admin/registration" className="pl-6">
                          <span>Registration Management</span>
                        </Link>
                      </DropdownMenuItem>
                    </>
                  )}
                </>
              ) : (
                <>
                  {/* Desktop - Keep sub-menu structure */}
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <User className="mr-2 h-4 w-4" />
                      <span>Account Settings</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem asChild>
                        <Link href="/accounts/settings">
                          <span>Overview</span>
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/accounts/settings#profile">
                          <span>Profile</span>
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/accounts/settings#password">
                          <span>Change Password</span>
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/accounts/settings#delete">
                          <span>Delete Account</span>
                        </Link>
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>

                  {user?.is_superuser && (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <Shield className="mr-2 h-4 w-4" />
                        <span>Admin Settings</span>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        <DropdownMenuItem asChild>
                          <Link href="/accounts/admin/users">
                            <span>User Management</span>
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link href="/accounts/admin/backups">
                            <span>Infospace Backups</span>
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link href="/accounts/admin/user-backups">
                            <span>User Backups</span>
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link href="/accounts/admin/registration">
                            <span>Registration Management</span>
                          </Link>
                        </DropdownMenuItem>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )}
                </>
              )}
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