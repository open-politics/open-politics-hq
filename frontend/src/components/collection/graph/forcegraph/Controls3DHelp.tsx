'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { HelpCircle } from 'lucide-react';

// =============================================================================
// Controls3DHelp — small "?" button that pops a cheat-sheet for the 3D camera
// controls. Three.js / OrbitControls map mouse + trackpad gestures in ways
// that aren't immediately obvious to first-time 3D users; this surfaces the
// vocabulary so they don't have to discover it by accident.
// =============================================================================

export const Controls3DHelp: React.FC = () => {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 bg-background/80 backdrop-blur-sm border"
          title="3D navigation help"
          aria-label="Show 3D navigation help"
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="right" className="w-72 text-xs space-y-2 p-3">
        <div className="font-semibold text-sm">3D navigation</div>
        <ul className="space-y-1.5 text-muted-foreground">
          <li><span className="text-foreground font-medium">Drag</span> — orbit around the cluster center</li>
          <li><span className="text-foreground font-medium">Scroll / pinch</span> — dolly camera in and out</li>
          <li><span className="text-foreground font-medium">Right-drag</span> — pan the camera (track-pad: two-finger drag with modifier)</li>
          <li><span className="text-foreground font-medium">Click</span> — select node and open details</li>
          <li><span className="text-foreground font-medium">Shift + click</span> — add to multi-selection (for merge)</li>
        </ul>
        <div className="pt-1 border-t text-[10px] text-muted-foreground">
          Edge labels and hidden node labels fade in as the camera approaches them. Marquee selection is 2D-only.
        </div>
      </PopoverContent>
    </Popover>
  );
};
