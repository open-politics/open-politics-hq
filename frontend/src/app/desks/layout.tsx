'use client'

import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/collection/unsorted/AppSidebar"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb"
import LottiePlaceholder from "@/components/ui/lottie-placeholder"
import useAuth from "@/hooks/useAuth"
import { useInfospaceStore } from "@/zustand_stores/storeInfospace"
import { useClassificationSettingsStore } from "@/zustand_stores/storeClassificationSettings"
import { Button } from "@/components/ui/button"
import { BrainCircuit } from "lucide-react"
import { useEffect, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useClassificationSystem } from '@/hooks/useClassificationSystem';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useRouter } from "next/navigation";


export default function DesksLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();  
  const activeInfospace = useInfospaceStore.getState().activeInfospace;
  const router = useRouter();
  if (typeof window === 'undefined' || isLoading) {
    return <LottiePlaceholder />
  }

  if (!user) {
    router.push('/accounts/login');
  }

  return (
    <div className="h-full max-h-screen flex flex-col md:flex-row overflow-hidden">
      <SidebarProvider>
        <AppSidebar className="fixed md:relative h-full md:h-auto" />
        <SidebarInset className="flex-1 flex flex-col pt-16">
          {/* <header className="flex h-12 shrink-0 items-center gap-2 px-4">
          {/* {user?.is_superuser &&
            <>
            <div className="flex items-center gap-2">
              <Breadcrumb className="pr-6 md:pr-2">
                <BreadcrumbList>
                  <BreadcrumbItem>
                    <BreadcrumbLink href="#">
                      <SidebarTrigger className="size-4" />
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            </div>
            </>
          } */}
          {/* </header> */}
          <main className="flex-1 overflow-hidden">
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </div>
  )
}