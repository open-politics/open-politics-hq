'use client';

import React, { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { FolderOpen, FileText, Layers } from 'lucide-react';

interface BundleNodeData {
  id: number;
  name: string;
  description?: string;
  asset_count?: number;
  is_landing_zone?: boolean;  // True if this is the input for a Flow
  is_output_zone?: boolean;   // True if this is the output of a Flow
  has_active_source?: boolean; // True if a source is actively feeding this
  has_active_flow?: boolean;   // True if a flow is watching this
}

function BundleNode({ data, selected }: NodeProps<BundleNodeData>) {
  const isActive = data.has_active_source || data.has_active_flow;
  
  // Color based on role
  let borderColor = 'border-amber-300 dark:border-amber-600';
  let bgColor = 'bg-amber-50 dark:bg-amber-950/20';
  
  if (data.is_output_zone) {
    borderColor = 'border-emerald-400 dark:border-emerald-600';
    bgColor = 'bg-emerald-50 dark:bg-emerald-950/20';
  } else if (data.is_landing_zone) {
    borderColor = 'border-blue-300 dark:border-blue-600';
    bgColor = 'bg-blue-50 dark:bg-blue-950/20';
  }

  return (
    <div 
      className={cn(
        "min-w-[140px] rounded-lg border-2 shadow-sm transition-all",
        borderColor,
        bgColor,
        selected && "ring-2 ring-primary ring-offset-2",
        isActive && "shadow-md"
      )}
    >
      {/* Target Handle (input) */}
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className="!w-3 !h-3 !border-2 !border-amber-500 !bg-white dark:!bg-gray-900"
      />

      {/* Header */}
      <div className="px-3 py-2 border-b border-inherit">
        <div className="flex items-center gap-2">
          <FolderOpen className={cn(
            "h-4 w-4 flex-shrink-0",
            data.is_output_zone ? "text-emerald-600 dark:text-emerald-400" :
            data.is_landing_zone ? "text-blue-600 dark:text-blue-400" :
            "text-amber-600 dark:text-amber-400"
          )} />
          <span className="font-medium text-sm truncate">{data.name}</span>
        </div>
        {data.description && (
          <p className="text-[10px] text-muted-foreground mt-1 truncate">
            {data.description}
          </p>
        )}
      </div>

      {/* Content */}
      <div className="px-3 py-2 space-y-1">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1 text-muted-foreground">
            <FileText className="h-3 w-3" />
            <span>{data.asset_count ?? 0} assets</span>
          </div>
        </div>
        
        {/* Role badges */}
        <div className="flex flex-wrap gap-1 mt-1">
          {data.is_landing_zone && (
            <Badge variant="outline" className="text-[9px] px-1 py-0 bg-blue-100 dark:bg-blue-900/30 border-blue-300">
              <Layers className="h-2 w-2 mr-0.5" />
              Input
            </Badge>
          )}
          {data.is_output_zone && (
            <Badge variant="outline" className="text-[9px] px-1 py-0 bg-emerald-100 dark:bg-emerald-900/30 border-emerald-300">
              <Layers className="h-2 w-2 mr-0.5" />
              Output
            </Badge>
          )}
          {data.has_active_source && (
            <Badge variant="outline" className="text-[9px] px-1 py-0 bg-green-100 dark:bg-green-900/30 border-green-300">
              📡 Streaming
            </Badge>
          )}
        </div>
      </div>

      {/* Source Handle (output) */}
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className="!w-3 !h-3 !border-2 !border-amber-500 !bg-white dark:!bg-gray-900"
      />
    </div>
  );
}

export default memo(BundleNode);
