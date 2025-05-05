'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { useDocumentDetail } from './DocumentDetailProvider';

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
  const { openDetailOverlay } = useDocumentDetail();

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (onClick) {
      onClick(e);
    } else {
      openDetailOverlay(documentId);
    }
  };

  return (
    <button
      onClick={handleClick}
      className={cn(
        "text-foreground hover:text-primary hover:underline cursor-pointer text-left p-0 m-0 bg-transparent border-none",
        className
      )}
      title={typeof children === 'string' ? children : `View details for ID ${documentId}`}
    >
      {children}
    </button>
  );
} 