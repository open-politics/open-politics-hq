'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { ChevronLeft, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The dock's navigation controls. The dock owns no chrome row of its own — instead
 * each content renders these inside the one top row it already needs (the search
 * bar, the title field, the detail header). Back (←) walks up the drill stack and
 * lands on the host's home (the feed) when empty; close (×) dismisses the dock.
 */

export function DockBack({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <Button
      variant="ghost" size="icon"
      className={cn('size-7 shrink-0 text-muted-foreground', className)}
      title="Back" onClick={onClick}
    >
      <ChevronLeft className="size-4" />
    </Button>
  );
}

export function DockClose({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <Button
      variant="ghost" size="icon"
      className={cn('size-7 shrink-0 text-muted-foreground', className)}
      title="Close" onClick={onClick}
    >
      <X className="size-4" />
    </Button>
  );
}
