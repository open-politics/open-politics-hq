'use client';

import React from 'react';
import { ChevronRight, Folder, FileText, Home } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface BreadcrumbItem {
  id: string;
  label: string;
  type: 'home' | 'bundle' | 'asset';
  onClick?: () => void;
}

interface BreadcrumbNavProps {
  items: BreadcrumbItem[];
  className?: string;
}

export function BreadcrumbNav({ items, className }: BreadcrumbNavProps) {
  if (items.length === 0) return null;

  const getIcon = (type: BreadcrumbItem['type']) => {
    switch (type) {
      case 'home':
        return <Home className="h-3.5 w-3.5" />;
      case 'bundle':
        return <Folder className="h-3.5 w-3.5 text-blue-500" />;
      case 'asset':
        return <FileText className="h-3.5 w-3.5 text-emerald-500" />;
    }
  };

  return (
    <nav 
      className={cn(
        "flex items-center gap-1 text-sm px-3 py-2 border-b bg-muted/30",
        className
      )}
      aria-label="Breadcrumb"
    >
      <ol className="flex items-center gap-1 flex-wrap">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const isClickable = !isLast && item.onClick;

          return (
            <li key={item.id} className="flex items-center gap-1">
              {index > 0 && (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0" />
              )}
              <button
                onClick={isClickable ? item.onClick : undefined}
                disabled={!isClickable}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors",
                  isClickable && "hover:bg-muted cursor-pointer",
                  isLast && "font-medium text-foreground",
                  !isLast && "text-muted-foreground"
                )}
              >
                {getIcon(item.type)}
                <span className="truncate max-w-[150px] sm:max-w-[200px]">
                  {item.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
