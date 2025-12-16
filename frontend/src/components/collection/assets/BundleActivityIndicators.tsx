'use client';

import React from 'react';
import { Radio, RefreshCw, ArrowRight, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface BundleActivityIndicatorsProps {
  hasActiveSources?: boolean;
  activeSourceCount?: number;
  hasMonitors?: boolean;
  monitorCount?: number;
  isPipelineInput?: boolean;
  pipelineInputCount?: number;
  isPipelineOutput?: boolean;
  pipelineOutputCount?: number;
  className?: string;
}

export function BundleActivityIndicators({
  hasActiveSources,
  activeSourceCount,
  hasMonitors,
  monitorCount,
  isPipelineInput,
  pipelineInputCount,
  isPipelineOutput,
  pipelineOutputCount,
  className,
}: BundleActivityIndicatorsProps) {
  const indicators: Array<{
    icon: React.ComponentType<{ className?: string }>;
    tooltip: string;
    color: string;
  }> = [];
  
  if (hasActiveSources && activeSourceCount && activeSourceCount > 0) {
    indicators.push({
      icon: Radio,
      tooltip: `${activeSourceCount} active stream${activeSourceCount > 1 ? 's' : ''}`,
      color: 'text-blue-500',
    });
  }
  
  if (hasMonitors && monitorCount && monitorCount > 0) {
    indicators.push({
      icon: RefreshCw,
      tooltip: `${monitorCount} monitor${monitorCount > 1 ? 's' : ''}`,
      color: 'text-green-500',
    });
  }
  
  if (isPipelineInput && pipelineInputCount && pipelineInputCount > 0) {
    indicators.push({
      icon: ArrowRight,
      tooltip: `Input to ${pipelineInputCount} pipeline${pipelineInputCount > 1 ? 's' : ''}`,
      color: 'text-purple-500',
    });
  }
  
  if (isPipelineOutput && pipelineOutputCount && pipelineOutputCount > 0) {
    indicators.push({
      icon: ArrowLeft,
      tooltip: `Output from ${pipelineOutputCount} pipeline${pipelineOutputCount > 1 ? 's' : ''}`,
      color: 'text-orange-500',
    });
  }
  
  if (indicators.length === 0) return null;
  
  return (
    <TooltipProvider delayDuration={300}>
      <div className={cn("inline-flex items-center gap-1 ml-1.5", className)}>
        {indicators.map((indicator, idx) => {
          const Icon = indicator.icon;
          return (
            <Tooltip key={idx}>
              <TooltipTrigger asChild>
                <span className={cn(
                  "inline-flex items-center justify-center",
                  "h-4 w-4 rounded-full",
                  "opacity-70 hover:opacity-100 transition-opacity",
                  indicator.color
                )}>
                  <Icon className="h-3 w-3" />
                </span>
              </TooltipTrigger>
              <TooltipContent 
                side="bottom" 
                className="text-xs px-2 py-1"
              >
                {indicator.tooltip}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}

