import React from 'react';
import { Badge } from '@/components/ui/badge';
import { FragmentDisplayProps } from './types';
import { FragmentBadge, FragmentCountBadge } from './FragmentBadge';
import { FragmentCard } from './FragmentCard';
import { FragmentFull } from './FragmentFull';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';

/**
 * Main fragment display component that renders fragments based on view mode
 */
export function FragmentDisplay({ 
  fragments,
  viewMode = 'full',
  onFragmentClick,
  onRunClick,
  className 
}: FragmentDisplayProps) {
  const router = useRouter();
  const { activeInfospace } = useInfospaceStore();
  
  const fragmentEntries = Object.entries(fragments);
  
  if (fragmentEntries.length === 0) {
    return null;
  }

  // Default run click handler - navigates to annotation runner
  const handleRunClick = (runId: string) => {
    if (onRunClick) {
      onRunClick(runId);
    } else if (activeInfospace) {
      // Navigate to annotation runner page
      router.push(`/hq/infospaces/annotation-runner?runId=${runId}`);
    }
  };

  // Badge mode - show count badge only
  if (viewMode === 'badge') {
    return (
      <FragmentCountBadge 
        count={fragmentEntries.length}
        className={className}
      />
    );
  }

  // Card or Full mode
  return (
    <div className={cn("space-y-3", className)}>
      {fragmentEntries.map(([key, fragmentData]) => {
        const fragment = fragmentData as any;
        
        if (viewMode === 'card') {
          return (
            <FragmentCard
              key={key}
              fragmentKey={key}
              fragment={fragment}
              onFragmentClick={onFragmentClick ? () => onFragmentClick(key, fragment) : undefined}
              onRunClick={handleRunClick}
            />
          );
        }
        
        // Default to full view
        return (
          <FragmentFull
            key={key}
            fragmentKey={key}
            fragment={fragment}
            onFragmentClick={onFragmentClick ? () => onFragmentClick(key, fragment) : undefined}
            onRunClick={handleRunClick}
          />
        );
      })}
    </div>
  );
}

/**
 * Fragment section header with count badge
 */
export function FragmentSectionHeader({ 
  count,
  className 
}: { 
  count: number;
  className?: string;
}) {
  return (
    <h4 className={cn("text-sm font-semibold mb-3 text-muted-foreground flex items-center gap-2", className)}>
      <Badge className="h-4 w-4 rounded-full p-0 flex items-center justify-center text-xs">F</Badge>
      Curated Fragments ({count} fragment{count !== 1 ? 's' : ''})
    </h4>
  );
}
