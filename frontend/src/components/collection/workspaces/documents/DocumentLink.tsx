'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface DocumentLinkProps {
  documentId: number;
  children: React.ReactNode;
  className?: string;
  fullPage?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}

export default function DocumentLink({
  documentId,
  children,
  className,
  fullPage = false,
  onClick
}: DocumentLinkProps) {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    
    if (onClick) {
      onClick(e);
      return;
    }
    
    console.warn(`DocumentLink clicked for ID: ${documentId}. Needs refactoring to open DataRecord/DataSource details.`);
  };

  return (
    <button
      onClick={handleClick}
      className={cn(
        "text-foreground hover:text-primary hover:underline cursor-pointer text-left",
        className
      )}
    >
      {children}
    </button>
  );
} 