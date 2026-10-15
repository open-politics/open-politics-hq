'use client';

import React from 'react';
import { SourceList } from '@/components/collection/intake/sources/SourceList';
import { HUD_LABEL } from '@/components/ui/chrome';
import { cn } from '@/lib/utils';

/**
 * The start of the flow: every source in the infospace, as the asset manager
 * lists them. The ones feeding this run are joined to its queue by lines
 * (`SourceStreams`, drawn by the strip around this column and the next).
 * Opened and closed from the assets column, on the edge between the two.
 */
export const RunSourcesColumn = React.forwardRef<HTMLDivElement>(function RunSourcesColumn(_props, listRef) {
  return (
    <section
      aria-label="Sources"
      data-run-column="sources"
      className="flex h-full w-72 shrink-0 snap-start flex-col bg-background"
    >
      {/* Level with the other columns' eyebrows. */}
      <div className="flex h-[22px] shrink-0 items-center px-4 pt-4 box-content">
        <span className={cn(HUD_LABEL, 'text-hud-dimmer')}>Sources</span>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 pt-2">
        <SourceList mode="panel" init={undefined} fullscreen={false} close={() => {}} escalate={() => {}} />
      </div>
    </section>
  );
});
