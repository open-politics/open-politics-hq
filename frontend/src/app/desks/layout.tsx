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
import { useWorkspaceStore } from "@/zustand_stores/storeWorkspace"
import { useClassificationSettingsStore } from "@/zustand_stores/storeClassificationSettings"
import { Button } from "@/components/ui/button"
import { BrainCircuit } from "lucide-react"
import { useEffect, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useClassificationSystem } from '@/hooks/useClassificationSystem';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useRouter } from "next/navigation";

function DefaultSchemeSelector() {
  const { activeWorkspace } = useWorkspaceStore();
  const { schemes, loadSchemes } = useClassificationSystem({
    autoLoadSchemes: true
  });
  const { getDefaultSchemeId, setDefaultSchemeId } = useClassificationSettingsStore();
  const [selectedSchemeId, setSelectedSchemeId] = useState<string | null>(null);
  
  useEffect(() => {
    if (!activeWorkspace?.id) return;
    
    const workspaceId = typeof activeWorkspace.id === 'string' 
      ? parseInt(activeWorkspace.id) 
      : activeWorkspace.id;
    
    loadSchemes().then(() => {
      const defaultId = getDefaultSchemeId(workspaceId, schemes);
      setSelectedSchemeId(defaultId?.toString() || '');
    });
  }, [activeWorkspace?.id, schemes, loadSchemes, getDefaultSchemeId]);
  
  const handleSchemeChange = (value: string) => {
    if (!activeWorkspace?.id) return;
    
    const workspaceId = typeof activeWorkspace.id === 'string' 
      ? parseInt(activeWorkspace.id) 
      : activeWorkspace.id;
    
    setSelectedSchemeId(value);
    setDefaultSchemeId(workspaceId, parseInt(value));
  };
  
  if (!activeWorkspace?.id || schemes.length === 0) {
    return null;
  }
  
  return (
    <div className="flex items-center gap-2">
      <Select
        value={selectedSchemeId || ''}
        onValueChange={handleSchemeChange}
      >
        <SelectTrigger className="h-8 w-full">
          <SelectValue placeholder="Select default scheme" />
        </SelectTrigger>
        <SelectContent>
          {schemes.map((scheme) => (
            <SelectItem key={scheme.id} value={scheme.id.toString()}>
              {scheme.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1">
              <span className="text-xs font-medium">?</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">Your base analyser. The selected scheme will be applied one-click when hitting the <BrainCircuit className="inline-block" /> icon</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      
    </div>
  );
}

export default function DesksLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();  
  const activeWorkspace = useWorkspaceStore.getState().activeWorkspace;
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
            <div className="flex-1 flex justify-end gap-2 h-10">
              <DefaultSchemeSelector />
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