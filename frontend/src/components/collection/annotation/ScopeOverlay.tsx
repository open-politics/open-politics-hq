'use client';

/**
 * ScopeOverlay — UI for cross-panel scope management.
 *
 * Rendered inside PanelRenderer's header area. Shows:
 * - Badge with count of incoming scopes
 * - Expandable drawer listing all incoming scopes
 * - Remove button per scope
 * - Push/link popover (appears after selection gestures in panels)
 */

import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { X, Link2, ArrowRight, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Scope, PanelConfig } from '@/lib/annotations/types';
import { describeScopeLabel } from '@/lib/annotations/scopes';

interface ScopeOverlayProps {
  panelConfig: PanelConfig;
  allPanels: PanelConfig[];
  onRemoveScope: (scopeId: string) => void;
}

export function ScopeBadge({ panelConfig, allPanels, onRemoveScope }: ScopeOverlayProps) {
  const [isOpen, setIsOpen] = useState(false);
  const scopes = panelConfig.incoming_scopes;

  if (scopes.length === 0) return null;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 px-2 gap-1">
          <Filter className="h-3 w-3" />
          <Badge variant="secondary" className="h-4 px-1 text-[10px]">
            {scopes.length}
          </Badge>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start">
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground px-1 pb-1">
            Incoming scopes
          </div>
          {scopes.map(scope => {
            const sourcePanel = allPanels.find(p => p.id === scope.source_panel_id);
            return (
              <div
                key={scope.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/50 text-xs"
              >
                <div className={cn(
                  "h-1.5 w-1.5 rounded-full flex-shrink-0",
                  scope.mode === 'link' ? "bg-blue-500" : "bg-green-500"
                )} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">
                    {sourcePanel?.name || 'Unknown panel'}
                    <span className="text-muted-foreground ml-1">
                      ({scope.mode})
                    </span>
                  </div>
                  <div className="text-muted-foreground truncate">
                    {describeScopeLabel(scope)}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0"
                  onClick={() => onRemoveScope(scope.id)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// --- Push/Link target picker ---

interface ScopeTargetPickerProps {
  sourcePanelId: string;
  allPanels: PanelConfig[];
  onPush: (targetPanelId: string) => void;
  onLink: (targetPanelId: string) => void;
  trigger: React.ReactNode;
}

export function ScopeTargetPicker({
  sourcePanelId,
  allPanels,
  onPush,
  onLink,
  trigger,
}: ScopeTargetPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const targetPanels = allPanels.filter(p => p.id !== sourcePanelId);

  if (targetPanels.length === 0) return null;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        {trigger}
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground px-1 pb-1">
            Send selection to...
          </div>
          {targetPanels.map(target => (
            <div key={target.id} className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="flex-1 justify-start h-7 text-xs"
                onClick={() => {
                  onPush(target.id);
                  setIsOpen(false);
                }}
              >
                <ArrowRight className="h-3 w-3 mr-1" />
                {target.name}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                title="Live link"
                onClick={() => {
                  onLink(target.id);
                  setIsOpen(false);
                }}
              >
                <Link2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
