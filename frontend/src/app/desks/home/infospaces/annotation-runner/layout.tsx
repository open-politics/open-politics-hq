'use client';

import { Metadata } from 'next';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { Home, ChevronRight, BrainCircuit } from 'lucide-react';
import Link from 'next/link';

export default function AnnotationRunnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { activeInfospace } = useInfospaceStore();

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center p-4 border-b">
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
                <Link href={`/desks/home/infospaces/${activeInfospace?.id}`}>
                  {activeInfospace?.name || 'Infospace'}
                </Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator>
              <ChevronRight className="h-4 w-4" />
            </BreadcrumbSeparator>
            <BreadcrumbItem>
              <BreadcrumbPage className="flex items-center">
                <BrainCircuit className="h-4 w-4 mr-1" />
                Annotation Runner
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      <div className="flex-1 overflow-auto">
        {children}
      </div>
    </div>
  );
} 