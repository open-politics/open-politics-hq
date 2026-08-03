'use client';

/**
 * HudPane — the shell every HUD region shares.
 *
 * One pane type, several instances. Items and evidence differ in what they
 * *render*, not in what they *are*, so they share a title bar, a count, a
 * collapse, and the link toggle. Making evidence its own component would have
 * put a domain noun back into the frame.
 *
 * The link toggle is the important control here. A pane following the lens
 * answers "what is in view"; a pane following the selection answers "what is
 * this". Both are wanted, often seconds apart — you fix the items pane, click
 * a row, and use it to jump the graph.
 */
import React from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ChevronDown, ChevronRight, Link2, Link2Off } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PaneFollow } from './hudChannels';

interface Props {
  title: string;
  count: number;
  /** Rendered right of the title — a type filter, a sort control. */
  controls?: React.ReactNode;
  follow: PaneFollow;
  onFollowChange?: (next: PaneFollow) => void;
  collapsed?: boolean;
  onCollapsedChange?: (next: boolean) => void;
  className?: string;
  children: React.ReactNode;
}

const FOLLOW_HINT: Record<PaneFollow, string> = {
  lens: 'Following the query — shows everything in view. Click to pin to the selection instead.',
  selection: 'Following the selection — shows what you clicked. Click to follow the query instead.',
};

export function HudPane({
  title, count, controls, follow, onFollowChange,
  collapsed = false, onCollapsedChange, className, children,
}: Props) {
  return (
    <div
      className={cn(
        'pointer-events-auto flex min-h-0 flex-col overflow-hidden rounded-lg border',
        'border-border/60 bg-background/85 backdrop-blur-sm shadow-sm',
        className,
      )}
    >
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border/50 px-2 py-1">
        <button
          type="button"
          onClick={() => onCollapsedChange?.(!collapsed)}
          className="flex items-center gap-1 text-xs font-medium text-foreground/90 hover:text-foreground"
        >
          {collapsed
            ? <ChevronRight className="h-3.5 w-3.5" />
            : <ChevronDown className="h-3.5 w-3.5" />}
          {title}
        </button>
        <span className="tabular-nums text-[11px] text-muted-foreground">{count}</span>
        <div className="ml-auto flex items-center gap-1">
          {controls}
          {onFollowChange && (
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => onFollowChange(follow === 'lens' ? 'selection' : 'lens')}
                  >
                    {follow === 'lens'
                      ? <Link2 className="h-3.5 w-3.5" />
                      : <Link2Off className="h-3.5 w-3.5 text-amber-500" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left" className="max-w-[240px] text-xs">
                  {FOLLOW_HINT[follow]}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>
      {!collapsed && (
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      )}
    </div>
  );
}
