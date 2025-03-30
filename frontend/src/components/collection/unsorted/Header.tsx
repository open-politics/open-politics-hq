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
              <Button variant="ghost" asChild>
                <a href="mailto:engage@open-politics.org">Contact</a>
              </Button>
              
              {/* GitHub Links */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 px-0">
                    <FaGithub />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="p-2 w-40 border-none">
                  <div className="flex flex-col space-y-0.5">
                    <a href="https://github.com/open-politics/open-politics" className="flex items-center space-x-1 py-1 hover:bg-secondary/70 rounded-md">
                      <Code />
                      <span>Webapp</span>
                    </a>
                    <a href="https://github.com/open-politics/opol" className="flex items-center space-x-1 py-1 hover:bg-secondary/70 rounded-md">
                      <Database />
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
                      <SidebarMenuItem>
                        <SidebarMenuButton asChild className="flex items-center space-x-2 w-full">
                          <Link href="https://docs.open-politics.org">
                            <span>Documentation</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                      <SidebarMenuItem>
                        <SidebarMenuButton asChild className="flex items-center space-x-2 w-full">
                          <a href="mailto:engage@open-politics.org">
                            <span>Contact</span>
                          </a>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                      
                      {isLoggedIn ? (
                        <>
                          <SidebarMenuItem>
                            <SidebarMenuButton asChild className="flex items-center space-x-2 w-full">
                              <Link href="/desks/home">
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
                            <SidebarMenuButton onClick={logout} className="w-full">
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
                      
                      <div className="flex items-center justify-between py-4 border-t">
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