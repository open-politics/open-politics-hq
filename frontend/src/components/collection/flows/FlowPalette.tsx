'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import {
  Filter,
  Microscope,
  Tag,
  GitBranch,
  Zap,
  Activity,
  Plus,
  RadioTower,
  FolderOpen,
  Workflow,
  GripVertical,
} from 'lucide-react';

interface FlowPaletteProps {
  onCreateSource?: () => void;
  onCreateBundle?: () => void;
  onCreateFlow?: () => void;
}

const stepTypes = [
  { type: 'FILTER', icon: Filter, label: 'Filter', description: 'Filter assets by conditions', color: 'text-orange-600' },
  { type: 'ANNOTATE', icon: Microscope, label: 'Annotate', description: 'Apply annotation schemas', color: 'text-purple-600' },
  { type: 'CURATE', icon: Tag, label: 'Curate', description: 'Promote fields to fragments', color: 'text-teal-600' },
  { type: 'ROUTE', icon: GitBranch, label: 'Route', description: 'Send to output bundle', color: 'text-blue-600' },
  { type: 'EMBED', icon: Zap, label: 'Embed', description: 'Generate vector embeddings', color: 'text-yellow-600' },
  { type: 'ANALYZE', icon: Activity, label: 'Analyze', description: 'Run analysis adapters', color: 'text-pink-600' },
];

export default function FlowPalette({ 
  onCreateSource, 
  onCreateBundle, 
  onCreateFlow 
}: FlowPaletteProps) {
  const onDragStart = (event: React.DragEvent, nodeType: string, data: Record<string, any>) => {
    event.dataTransfer.setData('application/reactflow', JSON.stringify({ nodeType, data }));
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="w-56 border-r bg-muted/30 flex flex-col h-full">
      <div className="p-3 border-b">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Workflow className="h-4 w-4" />
          Flow Builder
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          Drag to canvas or click to add
        </p>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-4">
          {/* Quick Actions */}
          <div>
            <h4 className="text-xs font-medium text-muted-foreground mb-2">Quick Add</h4>
            <div className="space-y-1">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start h-8"
                onClick={onCreateSource}
              >
                <Plus className="h-3 w-3 mr-2" />
                <RadioTower className="h-3 w-3 mr-1" />
                New Source
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start h-8"
                onClick={onCreateBundle}
              >
                <Plus className="h-3 w-3 mr-2" />
                <FolderOpen className="h-3 w-3 mr-1" />
                New Bundle
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start h-8"
                onClick={onCreateFlow}
              >
                <Plus className="h-3 w-3 mr-2" />
                <Activity className="h-3 w-3 mr-1" />
                New Flow
              </Button>
            </div>
          </div>

          <Separator />

          {/* Draggable Steps */}
          <div>
            <h4 className="text-xs font-medium text-muted-foreground mb-2">Flow Steps</h4>
            <div className="space-y-1">
              {stepTypes.map((step) => (
                <div
                  key={step.type}
                  draggable
                  onDragStart={(e) => onDragStart(e, 'step', { type: step.type })}
                  className={cn(
                    "flex items-center gap-2 p-2 rounded-md border bg-background cursor-grab",
                    "hover:bg-accent hover:border-accent-foreground/20 transition-colors",
                    "active:cursor-grabbing"
                  )}
                >
                  <GripVertical className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                  <step.icon className={cn("h-4 w-4 flex-shrink-0", step.color)} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{step.label}</p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {step.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* Legend */}
          <div>
            <h4 className="text-xs font-medium text-muted-foreground mb-2">Legend</h4>
            <div className="space-y-1.5 text-[10px]">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span>Active / Streaming</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-yellow-500" />
                <span>Paused</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-gray-400" />
                <span>Draft / Idle</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-red-500" />
                <span>Error</span>
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>

      {/* Help */}
      <div className="p-3 border-t text-[10px] text-muted-foreground">
        <p>💡 Connect Source → Bundle → Flow to create a streaming pipeline</p>
      </div>
    </div>
  );
}
