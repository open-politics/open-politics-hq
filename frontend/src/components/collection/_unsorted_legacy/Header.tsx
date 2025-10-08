'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { FaGithub } from "react-icons/fa6";
import { NewspaperIcon, Globe2, ZoomIn, Menu, X, ChevronRight, Sun, Moon } from "lucide-react";
import { useTheme } from "next-themes";
import useAuth from '@/hooks/useAuth';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Code, Database } from "lucide-react";
import { Mail, MessageSquare } from 'lucide-react';
import { Button } from "@/components/ui/button";
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
import TextWriter from "@/components/ui/extra-animated-base-components/text-writer";
import Image from 'next/image';

const Header = () => {
  const { theme, setTheme, systemTheme, resolvedTheme } = useTheme();

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
    <nav className="fixed top-0 z-50 w-full bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="w-full mx-auto px-2">
        <div className="flex h-14 items-center justify-between mx-auto">
          {/* Logo */}
          <Link href="/" className="flex items-center space-x-1 relative h-8">
            <Image 
              src={currentTheme === 'dark' ? "/logos/logo-opp-dark3.jpeg" : "/logos/logo-opp-light3.jpeg"}
              alt="Open Politics Project" 
              width={450} 
              height={60} 
              className="opacity-90 mt-2"
              priority
            />
          </Link>

          {/* Navigation Links and Icons */}
          <div className="flex items-center gap-1">
            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-1">
              <Button variant="ghost" asChild className="text-gray-900 dark:text-gray-100">
                <Link href="/webpages/about">About</Link>
              </Button>
              <Button variant="ghost" asChild className="text-gray-900 dark:text-gray-100">
                <Link href="https://docs.open-politics.org">Documentation</Link>
              </Button>
              {/* <Button variant="ghost" asChild>
                <Link href="/accounts/pricing">Pricing</Link>
              </Button> */}

              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" className="text-gray-900 dark:text-gray-100">Contact</Button>
                </PopoverTrigger>
                <PopoverContent className="w-48 rounded-md border bg-popover p-2 text-popover-foreground shadow-md">
                  <div className="flex flex-col space-y-0.5">
                    <a href="https://forum.open-politics.org" target="_blank" rel="noopener noreferrer" className="grid grid-cols-[auto_1fr] items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent focus:bg-accent focus:text-accent-foreground">
                      <MessageSquare className="h-4 w-4" />
                      <span>Forum/ Chat/ Discussion</span>
                    </a>
                    <a href="mailto:engage@open-politics.org" className="grid grid-cols-[auto_1fr] items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent focus:bg-accent focus:text-accent-foreground">
                      <Mail className="h-4 w-4" />
                      <span>Email</span>
                    </a>
                  </div>
                </PopoverContent>
              </Popover>
              
              {/* GitHub Links */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 px-0 text-gray-900 dark:text-gray-100">
                    <FaGithub />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-48 rounded-md border bg-popover p-2 text-popover-foreground shadow-md">
                  <div className="flex flex-col space-y-0.5">
                    <a href="https://github.com/open-politics/open-politics" target="_blank" rel="noopener noreferrer" className="grid grid-cols-[auto_1fr] items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent focus:bg-accent focus:text-accent-foreground">
                      <Code className="h-4 w-4" />
                      <span>Webapp (HQ)</span>
                    </a>
                    <a href="https://github.com/open-politics/opol" target="_blank" rel="noopener noreferrer" className="grid grid-cols-[auto_1fr] items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent focus:bg-accent focus:text-accent-foreground">
                      <Database className="h-4 w-4" />
                      <span>Data Engine (OPOL)</span>
                    </a>
                  </div>
                </PopoverContent>
              </Popover>

              {/* Auth Navigation */}
              {isLoggedIn && !isLoggingOut ? (
                <div className="flex items-center space-x-2">
                  <Button variant="ghost" asChild className="ring-1 ring-blue-500 ring-offset-0 px-6 rounded-lg">
                    <Link href="/hq">
                      <TextWriter
                        text={<div className="flex items-center gap-1">
                          <NewspaperIcon className="w-4 h-4" />
                          <Globe2 className="w-4 h-4" />
                          <ZoomIn className="w-4 h-4" />
                          <span>HQ</span>
                        </div>}
                        typingDelay={100}
                        startDelay={500}
                        className="animate-shimmer-once"
                        cursorColor="transparent"
                      />
                    </Link>
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" asChild className="text-gray-900 dark:text-gray-100">
                  <Link href="/accounts/login">Login</Link>
                </Button>
              )}
              
              {/* Manual theme switcher (not mode-switcher  ) */}
              <Button variant="ghost" onClick={toggleTheme} className="text-gray-900 dark:text-gray-100">
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
                  className="h-7 w-7"
                  onClick={toggleSidebar}
                >
                  <Menu className="h-4 w-4" />
                  <span className="sr-only">Toggle Navigation Menu</span>
                </Button>
                <Sidebar collapsible="icon" side="right" variant="floating" className='md:hidden' >
                  <SidebarHeader className="h-16 flex items-center px-4 border-b">
                    <SidebarMenu>
                      <SidebarMenuItem>
                        <SidebarMenuButton size="lg" asChild>
                          <Link href="/hq" className="flex items-center space-x-2">
                            <span className="font-semibold">Open Politics</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    </SidebarMenu>
                  </SidebarHeader>
                  
                  <SidebarContent className="flex-1 px-4 py-2">
                    <SidebarMenu>
                      <SidebarMenuItem>
                        <SidebarMenuButton asChild className="flex items-center space-x-2 w-full">
                          <Link href="/webpages/about">
                            <span>About</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                      {/* <SidebarMenuItem>
                        <SidebarMenuButton asChild className="flex items-center space-x-2 w-full">
                          <Link href="/accounts/pricing">
                            <span>Pricing</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem> */}
                      <SidebarMenuItem>
                        <SidebarMenuButton asChild className="flex items-center space-x-2 w-full">
                          <Link href="https://docs.open-politics.org">
                            <span>Documentation</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>

                      <div className="my-2 border-t border-border"></div> 

                      <SidebarMenuItem>
                          <SidebarMenuButton asChild className="flex items-center space-x-2 w-full">
                              <a href="https://forum.open-politics.org" target="_blank" rel="noopener noreferrer">
                                  <MessageSquare className="h-4 w-4 mr-2" />
                                  <span>Forum/ Discussion</span>
                              </a>
                          </SidebarMenuButton>
                      </SidebarMenuItem>
                      <SidebarMenuItem>
                        <SidebarMenuButton asChild className="flex items-center space-x-2 w-full">
                          <a href="mailto:engage@open-politics.org">
                            <Mail className="h-4 w-4 mr-2" />
                            <span>Email Contact</span>
                          </a>
                        </SidebarMenuButton>
                      </SidebarMenuItem>

                      <SidebarMenuItem>
                          <SidebarMenuButton asChild className="flex items-center space-x-2 w-full">
                              <a href="https://github.com/open-politics/open-politics" target="_blank" rel="noopener noreferrer">
                                  <Code className="h-4 w-4 mr-2" />
                                  <span>GitHub (HQ)</span>
                              </a>
                          </SidebarMenuButton>
                      </SidebarMenuItem>
                      <SidebarMenuItem>
                          <SidebarMenuButton asChild className="flex items-center space-x-2 w-full">
                              <a href="https://github.com/open-politics/opol" target="_blank" rel="noopener noreferrer">
                                  <Database className="h-4 w-4 mr-2" />
                                  <span>GitHub (OPOL)</span>
                              </a>
                          </SidebarMenuButton>
                      </SidebarMenuItem>

                      <div className="my-2 border-t border-border"></div>

                      {isLoggedIn && !isLoggingOut ? (
                        <>
                          <SidebarMenuItem>
                            <SidebarMenuButton asChild className="ring-1 ring-blue-500 ring-offset-0 px-6 rounded-lg">
                              <Link href="/hq">
                                <TextWriter
                                  text={<div className="flex items-center gap-1">
                                    <span>HQ</span>
                                  </div>}
                                  typingDelay={100}
                                  startDelay={500}
                                  className="animate-shimmer-once"
                                  cursorColor="transparent"
                                />
                              </Link>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                          {/* Not needed, is in the main nav user */}
                          {/* <SidebarMenuItem>
                            <SidebarMenuButton onClick={logout} className="w-full justify-start">
                              Logout
                            </SidebarMenuButton>
                          </SidebarMenuItem> */}
                        </>
                      ) : (
                        <SidebarMenuItem>
                          <SidebarMenuButton asChild className="flex items-center space-x-2 w-full">
                            <Link href="/accounts/login">
                              <span>Login</span>
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      )}
                      
                      <div className="my-2 border-t border-border"></div>

                      <div className="flex items-center justify-between py-2">
                        <Button variant="ghost" onClick={toggleTheme} className="text-gray-900 dark:text-gray-100">
                          {resolvedTheme === "dark" ? (
                            <Sun className="h-4 w-4" />
                          ) : (
                            <Moon className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </SidebarMenu>
                  </SidebarContent>

                  <SidebarFooter className="border-t p-4">
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