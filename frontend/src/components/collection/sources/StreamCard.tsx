'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StreamStatusBadge } from './StreamStatusBadge';
import {
  MoreVertical,
  Settings,
  Play,
  Pause,
  RefreshCw,
  FolderOpen,
  ExternalLink,
  Clock,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatDistanceToNowStrict } from 'date-fns';
import { cn } from '@/lib/utils';

interface StreamCardProps {
  source: {
    id: number;
    name: string;
    kind: string;
    status: string;
    is_active?: boolean;
    items_last_poll?: number;
    total_items_ingested?: number;
    last_poll_at?: string | null;
    next_poll_at?: string | null;
    output_bundle_id?: number | null;
    consecutive_failures?: number;
    stream_health?: string;
    details?: {
      feed_url?: string;
      search_config?: {
        query?: string;
      };
    };
  };
  outputBundleName?: string;
  onActivate?: (sourceId: number) => void;
  onPause?: (sourceId: number) => void;
  onPoll?: (sourceId: number) => void;
  onConfigure?: (source: any) => void;
  onViewItems?: (sourceId: number) => void;
  className?: string;
}

const sourceKindIcons = {
  rss: '📡',
  search: '🔍',
  url_list: '🔗',
  site_discovery: '🌐',
  upload: '📤',
};

export function StreamCard({
  source,
  outputBundleName,
  onActivate,
  onPause,
  onPoll,
  onConfigure,
  onViewItems,
  className,
}: StreamCardProps) {
  const status = source.status.toLowerCase() as 'active' | 'paused' | 'idle' | 'processing' | 'error' | 'pending';
  const isActive = (source.is_active ?? false) && status === 'active';
  
  const pollInterval = (source as any).poll_interval_seconds || 300;
  const itemsLastPoll = source.items_last_poll ?? 0;
  const itemsPerHour = itemsLastPoll > 0 
    ? Math.round((itemsLastPoll / pollInterval) * 3600)
    : 0;

  const lastPollTime = source.last_poll_at 
    ? formatDistanceToNowStrict(new Date(source.last_poll_at), { addSuffix: true })
    : 'Never';

  return (
    <Card className={cn('hover:shadow-md transition-shadow', className)}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="text-2xl flex-shrink-0">
              {sourceKindIcons[source.kind as keyof typeof sourceKindIcons] || '📄'}
            </div>
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base truncate">{source.name}</CardTitle>
              <CardDescription className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className="text-xs">
                  {source.kind.replace('_', ' ')}
                </Badge>
                <StreamStatusBadge status={status} />
              </CardDescription>
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {isActive ? (
                <DropdownMenuItem onClick={() => onPause?.(source.id)}>
                  <Pause className="h-4 w-4 mr-2" />
                  Pause Stream
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => onActivate?.(source.id)}>
                  <Play className="h-4 w-4 mr-2" />
                  Activate Stream
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => onPoll?.(source.id)}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Poll Now
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onConfigure?.(source)}>
                <Settings className="h-4 w-4 mr-2" />
                Configure
              </DropdownMenuItem>
              {onViewItems && (
                <DropdownMenuItem onClick={() => onViewItems(source.id)}>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  View Items
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-3">
        {/* Activity Indicator */}
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Items/hour:</span>
            <span className="font-medium">{itemsPerHour}</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">{lastPollTime}</span>
          </div>
        </div>

        {/* Simple Activity Bar */}
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full transition-all duration-300',
              itemsPerHour > 10 ? 'bg-green-500' : itemsPerHour > 0 ? 'bg-blue-500' : 'bg-gray-300'
            )}
            style={{ width: `${Math.min((itemsPerHour / 50) * 100, 100)}%` }}
          />
        </div>

        {/* Output Routing - Prominent Display */}
        <div className="pt-2 border-t space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Output Routing</span>
            {onConfigure && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => onConfigure(source)}
              >
                <Settings className="h-3 w-3 mr-1" />
                Edit
              </Button>
            )}
          </div>
          {source.output_bundle_id && outputBundleName ? (
            <div className="flex items-center gap-2 p-2 bg-blue-50 dark:bg-blue-950/20 rounded-md border border-blue-200 dark:border-blue-800">
              <FolderOpen className="h-4 w-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
              <span className="font-medium text-sm text-blue-900 dark:text-blue-100 truncate flex-1">
                {outputBundleName}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-md border border-dashed">
              <FolderOpen className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="text-sm text-muted-foreground">No output bundle</span>
            </div>
          )}
        </div>

        {/* Source Details */}
        <div className="space-y-1 text-xs text-muted-foreground">
          {source.details?.feed_url && (
            <div className="truncate" title={source.details.feed_url}>
              {source.details.feed_url}
            </div>
          )}
          {source.details?.search_config?.query && (
            <div className="truncate">
              Query: "{source.details.search_config.query}"
            </div>
          )}
        </div>

        {/* Statistics */}
        <div className="flex items-center justify-between pt-2 border-t text-xs text-muted-foreground">
          <span>Total: {(source.total_items_ingested ?? 0).toLocaleString()}</span>
          {(source.consecutive_failures ?? 0) > 0 && (
            <span className="text-red-600">
              {source.consecutive_failures} failure{(source.consecutive_failures ?? 0) !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

