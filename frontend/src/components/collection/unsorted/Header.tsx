'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { FaGithub } from "react-icons/fa6";
import { Switch } from "@/components/ui/switch";
import { NewspaperIcon, Globe2, ZoomIn } from "lucide-react";
import { useTheme } from "next-themes";
import useAuth from '@/hooks/useAuth';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Code, Database } from "lucide-react";
import { Mail, MessageSquare } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { ModeSwitcher } from "@/components/ui/mode-switcher";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger
} from "@/components/ui/sidebar"; 
import { NavUser } from '../../ui/nav-user';
import Image from 'next/image';
import TextWriter from "@/components/ui/extra-animated-base-components/text-writer";

const Header = () => {
  const { theme, setTheme, systemTheme } = useTheme();
  const { logout, user, isLoggedIn } = useAuth();
  const [mounted, setMounted] = useState(false);

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
          <Link href="/" className="flex items-center space-x-1 relative">
            {/* <div className="absolute left-0 -z-10">
              <Image 
                src={currentTheme === 'dark' ? "/logos/logo-white.svg" : "/logos/logo-black.svg"} 
                alt="Open Politics Project" 
                width={15} 
                height={15} 
                className={`opacity-90 ${
                  currentTheme === 'dark' 
                    ? 'drop-shadow-[0_0_3px_rgba(255,255,255,0.3)]' 
                    : 'drop-shadow-[0_0_3px_rgba(10,61,145,0.3)]'
                }`}
              />
            </div> */}
            <div className="w-5" />
            <div className="logo-text-container">
              <span className="text-lg font-semibold text-primary relative">
                {/* <div className="animated-line" />
                <div className="text-highlight mb-2" /> */}
                <span className="text-lg font-semibold text-primary relative">Open Politics Project</span>
              </span>
            </div>
          </Link>

          {/* Navigation Links and Icons */}
          <div className="flex items-center gap-1">
            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-1">
              <Button variant="ghost" asChild>
                <Link href="/webpages/about">About</Link>
              </Button>
              <Button variant="ghost" asChild>
                <Link href="https://docs.open-politics.org">Documentation</Link>
              </Button>
              {/* <Button variant="ghost" asChild>
                <Link href="/accounts/pricing">Pricing</Link>
              </Button> */}

              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost">Contact</Button>
                </PopoverTrigger>
                <PopoverContent className="w-48 rounded-md border bg-popover p-2 text-popover-foreground shadow-md">
                  <div className="flex flex-col space-y-0.5">
                    <a href="https://discord.gg/AhqmEUr99T" target="_blank" rel="noopener noreferrer" className="grid grid-cols-[auto_1fr] items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent focus:bg-accent focus:text-accent-foreground">
                      <MessageSquare className="h-4 w-4" />
                      <span>Discord</span>
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
                  <Button variant="ghost" size="icon" className="h-8 w-8 px-0">
                    <FaGithub />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-48 rounded-md border bg-popover p-2 text-popover-foreground shadow-md">
                  <div className="flex flex-col space-y-0.5">
                    <a href="https://github.com/open-politics/open-politics" target="_blank" rel="noopener noreferrer" className="grid grid-cols-[auto_1fr] items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent focus:bg-accent focus:text-accent-foreground">
                      <Code className="h-4 w-4" />
                      <span>Webapp</span>
                    </a>
                    <a href="https://github.com/open-politics/opol" target="_blank" rel="noopener noreferrer" className="grid grid-cols-[auto_1fr] items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent focus:bg-accent focus:text-accent-foreground">
                      <Database className="h-4 w-4" />
                      <span>Data Engine</span>
                    </a>
                  </div>
                </PopoverContent>
              </Popover>

              {/* Auth Navigation */}
              {isLoggedIn  ? (
                <div className="flex items-center space-x-2">
                  <Button variant="ghost" asChild className="ring-1 ring-blue-500 ring-offset-0 px-6 rounded-lg">
                    <Link href="/desks/home">
                      <TextWriter
                        text={<div className="flex items-center gap-1">
                          <NewspaperIcon className="w-4 h-4" />
                          <Globe2 className="w-4 h-4" />
                          <ZoomIn className="w-4 h-4" />
                          <span>Desk</span>
                        </div>}
                        typingDelay={100}
                        startDelay={500}
                        className="animate-shimmer-once"
                        cursorColor="transparent"
                      />
                    </Link>
                  </Button>
                  <Button variant="ghost" onClick={logout}>Logout</Button>
                </div>
              ) : (
                <Button variant="ghost" asChild>
                  <Link href="/accounts/login">Login</Link>
                </Button>
              )}

              <ModeSwitcher />
            </div>

            {/* Mobile Navigation */}
            <div className="md:hidden">
                <SidebarTrigger/>
                <Sidebar collapsible="icon" side="right" variant="floating" className='md:hidden' >
                  <SidebarHeader className="h-16 flex items-center px-4 border-b">
                    <SidebarMenu>
                      <SidebarMenuItem>
                        <SidebarMenuButton size="lg" asChild>
                          <Link href="/desks/home" className="flex items-center space-x-2">
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
                              <a href="https://discord.gg/AhqmEUr99T" target="_blank" rel="noopener noreferrer">
                                  <MessageSquare className="h-4 w-4 mr-2" />
                                  <span>Discord</span>
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
                                  <span>GitHub (Webapp)</span>
                              </a>
                          </SidebarMenuButton>
                      </SidebarMenuItem>
                      <SidebarMenuItem>
                          <SidebarMenuButton asChild className="flex items-center space-x-2 w-full">
                              <a href="https://github.com/open-politics/opol" target="_blank" rel="noopener noreferrer">
                                  <Database className="h-4 w-4 mr-2" />
                                  <span>GitHub (Data Engine)</span>
                              </a>
                          </SidebarMenuButton>
                      </SidebarMenuItem>

                      <div className="my-2 border-t border-border"></div>

                      {isLoggedIn ? (
                        <>
                          <SidebarMenuItem>
                            <SidebarMenuButton asChild className="flex items-center space-x-2 w-full">
                              <Link href="/desks/home">
                                <NewspaperIcon className="h-4 w-4 mr-1" />
                                <Globe2 className="h-4 w-4 mr-1" />
                                <ZoomIn className="h-4 w-4 mr-2" />
                                <span>Desk</span>
                              </Link>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                          {user?.is_superuser && (
                            <SidebarMenuItem>
                              <SidebarMenuButton asChild className="flex items-center space-x-2 w-full">
                                <Link href="/accounts/admin/users">
                                  <span>Admin</span>
                                </Link>
                              </SidebarMenuButton>
                            </SidebarMenuItem>
                          )}
                          <SidebarMenuItem>
                            <SidebarMenuButton onClick={logout} className="w-full justify-start">
                              Logout
                            </SidebarMenuButton>
                          </SidebarMenuItem>
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
                        <span>Dark Mode</span>
                        <Switch
                          checked={theme === 'dark'}
                          onCheckedChange={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                        />
                      </div>
                    </SidebarMenu>
                  </SidebarContent>

                  <SidebarFooter className="border-t p-4">
                    {isLoggedIn && (
                      <NavUser user={{
                        name: user?.full_name || 'User',
                        email: user?.email || '',
                        avatar: user?.avatar || '',
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