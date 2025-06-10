'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { useAssetDetail } from '../Views/AssetDetailProvider';

interface AssetLinkProps {
  assetId: number;
  children: React.ReactNode;
  className?: string;
  fullPage?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  disabled?: boolean;
}

export default function AssetLink({
  assetId,
  children,
  className,
  fullPage = false,
  onClick,
  disabled = false
}: AssetLinkProps) {
  const { openDetailOverlay } = useAssetDetail();

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (disabled) {
      return;
    }

    if (onClick) {
      onClick(e);
    } else {
      console.log(`[AssetLink] Opening asset detail for ID: ${assetId}`);
      openDetailOverlay(assetId);
    }
  };

  if (disabled) {
    return (
      <span
        className={cn(
          "text-muted-foreground cursor-not-allowed",
          className
        )}
        title="Asset link disabled"
      >
        {children}
      </span>
    );
  }

  return (
    <button
      onClick={handleClick}
      className={cn(
        "text-foreground hover:text-primary hover:underline cursor-pointer text-left p-0 m-0 bg-transparent border-none transition-colors",
        "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 rounded-sm",
        fullPage && "block w-full",
        className
      )}
      title={typeof children === 'string' ? children : `View details for Asset ${assetId}`}
      type="button"
    >
      {children}
    </button>
  );
} 