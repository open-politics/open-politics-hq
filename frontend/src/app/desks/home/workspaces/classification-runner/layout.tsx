'use client';

import { Metadata } from 'next';
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { Home, ChevronRight, BrainCircuit } from 'lucide-react';
import Link from 'next/link';

export default function ClassificationRunnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { activeWorkspace } = useWorkspaceStore();

  return (
    <div className="flex flex-col h-full">
      {/* <div className="flex items-center p-4 border-b">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/desks/home">
                  <Home className="h-4 w-4" />
                </Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator>
              <ChevronRight className="h-4 w-4" />
            </BreadcrumbSeparator>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href={`/desks/home/workspaces/${activeWorkspace?.uid}`}>
                  {activeWorkspace?.name || 'Workspace'}
                </Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator>
              <ChevronRight className="h-4 w-4" />
            </BreadcrumbSeparator>
            <BreadcrumbItem>
              <BreadcrumbPage className="flex items-center">
                <BrainCircuit className="h-4 w-4 mr-1" />
                Classification Runner
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div> */}
      <div className="flex-1 overflow-auto">
        {children}
      </div>
    </div>
  );
} 