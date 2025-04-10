'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { useDocumentStore } from '@/zustand_stores/storeDocuments';

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
  const { openDocumentDetail } = useDocumentStore();

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    
    if (onClick) {
      onClick(e);
      return;
    }
    
    // Open the document detail using the store
    openDocumentDetail(documentId);
  };

  return (
    <button
      onClick={handleClick}
      className={cn(
        "text-foreground hover:text-primary hover:underline cursor-pointer",
        className
      )}
    >
      {children}
    </button>
  );
} 