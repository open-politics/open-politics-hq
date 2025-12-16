'use client';

import React, { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { RadioTower, Rss, Search, Upload, Globe, Clock, TrendingUp } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';

const sourceKindIcons: Record<string, React.ElementType> = {
  rss: Rss,
  search: Search,
  url_list: Globe,
  site_discovery: Globe,
  upload: Upload,
};

const statusColors: Record<string, { border: string; bg: string; dot: string }> = {
  active: { 
    border: 'border-green-400 dark:border-green-600', 
    bg: 'bg-green-50 dark:bg-green-950/30',
    dot: 'bg-green-500'
  },
  paused: { 
    border: 'border-yellow-400 dark:border-yellow-600', 
    bg: 'bg-yellow-50 dark:bg-yellow-950/30',
    dot: 'bg-yellow-500'
  },
  error: { 
    border: 'border-red-400 dark:border-red-600', 
    bg: 'bg-red-50 dark:bg-red-950/30',
    dot: 'bg-red-500'
  },
  idle: { 
    border: 'border-gray-300 dark:border-gray-600', 
    bg: 'bg-gray-50 dark:bg-gray-900',
    dot: 'bg-gray-400'
  },
};

interface SourceNodeData {
  id: number;
  name: string;
  kind: string;
  status: string;
  is_active?: boolean;
  items_last_poll?: number;
  total_items_ingested?: number;
  last_poll_at?: string | null;
  poll_interval_seconds?: number;
  output_bundle_id?: number | null;
}

function SourceNode({ data, selected }: NodeProps<SourceNodeData>) {
  const status = (data.is_active && data.status?.toLowerCase() === 'active') ? 'active' : 
                 data.status?.toLowerCase() || 'idle';
  const colors = statusColors[status] || statusColors.idle;
  const Icon = sourceKindIcons[data.kind] || RadioTower;
  
  const pollInterval = data.poll_interval_seconds || 300;
  const itemsLastPoll = data.items_last_poll ?? 0;
  const itemsPerHour = itemsLastPoll > 0 
    ? Math.round((itemsLastPoll / pollInterval) * 3600)
    : 0;

  const lastPollTime = data.last_poll_at 
    ? formatDistanceToNowStrict(new Date(data.last_poll_at), { addSuffix: true })
    : 'Never';

  return (
    <div 
      className={cn(
        "min-w-[160px] rounded-lg border-2 shadow-sm transition-all",
        colors.border,
        colors.bg,
        selected && "ring-2 ring-primary ring-offset-2",
        status === 'active' && "shadow-md"
      )}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-inherit">
        <div className="flex items-center gap-2">
          <div className={cn(
            "w-2 h-2 rounded-full flex-shrink-0",
            colors.dot,
            status === 'active' && "animate-pulse"
          )} />
          <Icon className="h-4 w-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
          <span className="font-medium text-sm truncate">{data.name}</span>
        </div>
        <div className="flex items-center gap-1 mt-1">
          <Badge variant="outline" className="text-[10px] px-1 py-0">
            {data.kind}
          </Badge>
        </div>
      </div>

      {/* Stats */}
      <div className="px-3 py-2 space-y-1 text-xs text-muted-foreground">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <TrendingUp className="h-3 w-3" />
            <span>{itemsPerHour}/hr</span>
          </div>
          <span className="text-[10px]">{(data.total_items_ingested ?? 0).toLocaleString()} total</span>
        </div>
        <div className="flex items-center gap-1 text-[10px]">
          <Clock className="h-2.5 w-2.5" />
          <span>{lastPollTime}</span>
        </div>
      </div>

      {/* Source Handle (output) */}
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className={cn(
          "!w-3 !h-3 !border-2 !border-blue-500 !bg-white dark:!bg-gray-900",
          status === 'active' && "!bg-green-100"
        )}
      />
    </div>
  );
}

export default memo(SourceNode);
