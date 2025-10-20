'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { FaGithub } from "react-icons/fa6";
import { Menu, X, ChevronRight, Sun, Moon } from "lucide-react";
import { useTheme } from "next-themes";
import useAuth from '@/hooks/useAuth';
import { Code, Database } from "lucide-react";
import { Mail, MessageSquare } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { useRouter } from 'next/navigation';
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
  useSidebar
} from "@/components/ui/sidebar"; 
import { NavUser } from '../../ui/nav-user';
import { RippleButton } from '@/components/ui/ripple-button';

const Header = () => {
  const { theme, setTheme, systemTheme, resolvedTheme } = useTheme();
  const router = useRouter();
  const toggleTheme = React.useCallback(() => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark")
  }, [resolvedTheme, setTheme])
  const { logout, user, isLoggedIn, isLoggingOut } = useAuth();
  const [mounted, setMounted] = useState(false);
  const { toggleSidebar } = useSidebar();

  useEffect(() => {
    setMounted(true);
  }, []);

  const currentTheme = useMemo(() => {
    if (!mounted) return null;
    return theme === 'system' ? systemTheme : theme;
  }, [theme, systemTheme, mounted]);

  if (!mounted) {
    return <nav className="h-16" />; // Prevent layout shift during SSR
  }

  return (
    <nav className="fixed top-0 z-50 w-full bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border/40">
      <div className="w-full mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center group transition-all">
            <span className="text-xl tracking-tight text-foreground group-hover:text-foreground/70 transition-colors">
              <span className="font-bold">Open Politics</span> <span className="font-light">Project</span>
            </span>
          </Link>

          {/* Navigation Links and Icons */}
          <div className="flex items-center gap-2">
            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-1.5">
              <NavigationMenu>
                <NavigationMenuList>
                  <NavigationMenuItem>
                    <NavigationMenuLink asChild className={navigationMenuTriggerStyle()}>
                      <Link href="/webpages/about">About</Link>
                    </NavigationMenuLink>
                  </NavigationMenuItem>
                  
                  <NavigationMenuItem>
                    <NavigationMenuLink asChild className={navigationMenuTriggerStyle()}>
                      <Link href="https://docs.open-politics.org">Documentation</Link>
                    </NavigationMenuLink>
                  </NavigationMenuItem>

                  <NavigationMenuItem>
                    <NavigationMenuTrigger>Contact</NavigationMenuTrigger>
                    <NavigationMenuContent>
                      <div className="w-52 p-2">
                        <NavigationMenuLink asChild>
                          <a 
                            href="https://forum.open-politics.org" 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                          >
                            <MessageSquare className="h-4 w-4 shrink-0" />
                            <span>Forum / Discussion</span>
                          </a>
                        </NavigationMenuLink>
                        <NavigationMenuLink asChild>
                          <a 
                            href="mailto:engage@open-politics.org" 
                            className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                          >
                            <Mail className="h-4 w-4 shrink-0" />
                            <span>Email</span>
                          </a>
                        </NavigationMenuLink>
                      </div>
                    </NavigationMenuContent>
                  </NavigationMenuItem>

                  <NavigationMenuItem>
                    <NavigationMenuTrigger>
                      <FaGithub className="h-4 w-4" />
                    </NavigationMenuTrigger>
                    <NavigationMenuContent>
                      <div className="w-52 p-2">
                        <NavigationMenuLink asChild>
                          <a 
                            href="https://github.com/open-politics/open-politics" 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                          >
                            <Code className="h-4 w-4 shrink-0" />
                            <span>Webapp (HQ)</span>
                          </a>
                        </NavigationMenuLink>
                        <NavigationMenuLink asChild>
                          <a 
                            href="https://github.com/open-politics/opol" 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                          >
                            <Database className="h-4 w-4 shrink-0" />
                            <span>Data Engine (OPOL)</span>
                          </a>
                        </NavigationMenuLink>
                      </div>
                    </NavigationMenuContent>
                  </NavigationMenuItem>

                  {/* Auth Navigation */}
                  {isLoggedIn && !isLoggingOut ? (
                    <NavigationMenuItem>
                      <div className="flex items-center gap-2 text-sm">
                        <NavigationMenuLink asChild className={navigationMenuTriggerStyle()}>
                          <RippleButton
                            duration="600ms"
                            rippleColor="#3b82f6"
                            className="h-8 font-bold"
                            onClick={() => router.push('/hq')}
                          >
                            <span>HQ</span>
                          </RippleButton>
                        </NavigationMenuLink>
                      </div>
                    </NavigationMenuItem>
                  ) : (
                    <NavigationMenuItem>
                      <NavigationMenuLink asChild className={navigationMenuTriggerStyle()}>
                        <Link href="/accounts/login">Login</Link>
                      </NavigationMenuLink>
                    </NavigationMenuItem>
                  )}
                </NavigationMenuList>
              </NavigationMenu>
              
              {/* Theme switcher */}
              <Button variant="ghost" size="icon" onClick={toggleTheme} className="h-9 w-9">
                {resolvedTheme === "dark" ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
              </Button>

            </div>

            {/* Mobile Navigation */}
            <div className="md:hidden">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={toggleSidebar}
                >
                  <Menu className="h-4 w-4" />
                  <span className="sr-only">Toggle Navigation Menu</span>
                </Button>
                <Sidebar collapsible="icon" side="right" variant="floating" className='md:hidden' >
                  <SidebarHeader className="h-16 flex items-center px-4 border-b border-border/50">
                    <SidebarMenu>
                      <SidebarMenuItem>
                        <SidebarMenuButton size="lg" asChild>
                          <Link href="/" className="flex items-center">
                            <span className="font-bold">Open Politics</span>
                            <span className="font-light ml-1.5">Project</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    </SidebarMenu>
                  </SidebarHeader>
                  
                  <SidebarContent className="flex-1 px-3 py-3">
                    <SidebarMenu className="space-y-1">
                      <SidebarMenuItem>
                        <SidebarMenuButton asChild>
                          <Link href="/webpages/about">About</Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                      <SidebarMenuItem>
                        <SidebarMenuButton asChild>
                          <Link href="https://docs.open-politics.org">Documentation</Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>

                      <div className="my-3 border-t border-border/50"></div> 

                      <SidebarMenuItem>
                        <SidebarMenuButton asChild>
                          <a href="https://forum.open-politics.org" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2">
                            <MessageSquare className="h-4 w-4 shrink-0" />
                            <span>Forum / Discussion</span>
                          </a>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                      <SidebarMenuItem>
                        <SidebarMenuButton asChild>
                          <a href="mailto:engage@open-politics.org" className="flex items-center gap-2">
                            <Mail className="h-4 w-4 shrink-0" />
                            <span>Email Contact</span>
                          </a>
                        </SidebarMenuButton>
                      </SidebarMenuItem>

                      <div className="my-3 border-t border-border/50"></div>

                      <SidebarMenuItem>
                        <SidebarMenuButton asChild>
                          <a href="https://github.com/open-politics/open-politics" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2">
                            <Code className="h-4 w-4 shrink-0" />
                            <span>GitHub (HQ)</span>
                          </a>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                      <SidebarMenuItem>
                        <SidebarMenuButton asChild>
                          <a href="https://github.com/open-politics/opol" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2">
                            <Database className="h-4 w-4 shrink-0" />
                            <span>GitHub (OPOL)</span>
                          </a>
                        </SidebarMenuButton>
                      </SidebarMenuItem>

                      <div className="my-3 border-t border-border/50"></div>

                      {isLoggedIn && !isLoggingOut ? (
                        <SidebarMenuItem>
                          <SidebarMenuButton asChild>
                            <RippleButton
                              duration="600ms"
                              rippleColor="#3b82f6"
                              className="h-8 font-bold"
                              onClick={() => router.push('/hq')}
                            >
                              <span>HQ</span>
                            </RippleButton>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ) : (
                        <SidebarMenuItem>
                          <SidebarMenuButton asChild>
                            <Link href="/accounts/login">Login</Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      )}
                      
                      <div className="my-3 border-t border-border/50"></div>

                      <SidebarMenuItem>
                        <Button 
                          variant="ghost" 
                          onClick={toggleTheme} 
                          className="w-full justify-start"
                        >
                          {resolvedTheme === "dark" ? (
                            <>
                              <Sun className="h-4 w-4 mr-2" />
                              <span>Light Mode</span>
                            </>
                          ) : (
                            <>
                              <Moon className="h-4 w-4 mr-2" />
                              <span>Dark Mode</span>
                            </>
                          )}
                        </Button>
                      </SidebarMenuItem>
                    </SidebarMenu>
                  </SidebarContent>

                  <SidebarFooter className="border-t border-border/50 p-4">
                    {isLoggedIn && !isLoggingOut && (
                      <NavUser user={{
                        name: user?.full_name || 'User',
                        email: user?.email || '',
                        avatar: user?.avatar || '',
                        profile_picture_url: user?.profile_picture_url || '',
                        is_superuser: user?.is_superuser || false,
                        full_name: user?.full_name || '',
                      }} />
                    )}
                  </SidebarFooter>
                </Sidebar>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Header;