'use client';

import React from 'react';
import { Node } from 'reactflow';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import {
  X,
  RadioTower,
  FolderOpen,
  Activity,
  Play,
  Pause,
  Trash2,
  Settings,
  ExternalLink,
  RefreshCw,
  Clock,
  Zap,
} from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';

interface NodePropertiesPanelProps {
  selectedNode: Node | null;
  onClose: () => void;
  onActivateFlow?: (flowId: number) => void;
  onPauseFlow?: (flowId: number) => void;
  onTriggerFlow?: (flowId: number) => void;
  onDeleteFlow?: (flowId: number) => void;
  onActivateSource?: (sourceId: number) => void;
  onPauseSource?: (sourceId: number) => void;
  onPollSource?: (sourceId: number) => void;
  onViewBundle?: (bundleId: number) => void;
}

export default function NodePropertiesPanel({
  selectedNode,
  onClose,
  onActivateFlow,
  onPauseFlow,
  onTriggerFlow,
  onDeleteFlow,
  onActivateSource,
  onPauseSource,
  onPollSource,
  onViewBundle,
}: NodePropertiesPanelProps) {
  if (!selectedNode) return null;

  const nodeType = selectedNode.type;
  const data = selectedNode.data;

  const renderSourcePanel = () => (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <RadioTower className="h-5 w-5 text-blue-600" />
        <div>
          <h3 className="font-semibold">{data.name}</h3>
          <Badge variant="outline" className="text-xs">{data.kind}</Badge>
        </div>
      </div>

      <Separator />

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-muted-foreground text-xs">Status</p>
          <Badge 
            variant={data.is_active && data.status === 'active' ? 'default' : 'secondary'}
            className="mt-1"
          >
            {data.status || 'idle'}
          </Badge>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Items/Hour</p>
          <p className="font-medium">
            {data.items_last_poll ? Math.round((data.items_last_poll / (data.poll_interval_seconds || 300)) * 3600) : 0}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Total Ingested</p>
          <p className="font-medium">{(data.total_items_ingested ?? 0).toLocaleString()}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Last Poll</p>
          <p className="font-medium text-xs">
            {data.last_poll_at 
              ? formatDistanceToNowStrict(new Date(data.last_poll_at), { addSuffix: true })
              : 'Never'}
          </p>
        </div>
      </div>

      <Separator />

      <div className="space-y-2">
        {data.is_active && data.status === 'active' ? (
          <Button 
            variant="outline" 
            className="w-full" 
            size="sm"
            onClick={() => onPauseSource?.(data.id)}
          >
            <Pause className="h-4 w-4 mr-2" />
            Pause Stream
          </Button>
        ) : (
          <Button 
            variant="outline" 
            className="w-full" 
            size="sm"
            onClick={() => onActivateSource?.(data.id)}
          >
            <Play className="h-4 w-4 mr-2" />
            Activate Stream
          </Button>
        )}
        <Button 
          variant="outline" 
          className="w-full" 
          size="sm"
          onClick={() => onPollSource?.(data.id)}
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Poll Now
        </Button>
      </div>
    </div>
  );

  const renderBundlePanel = () => (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <FolderOpen className={cn(
          "h-5 w-5",
          data.is_output_zone ? "text-emerald-600" :
          data.is_landing_zone ? "text-blue-600" :
          "text-amber-600"
        )} />
        <div>
          <h3 className="font-semibold">{data.name}</h3>
          {data.description && (
            <p className="text-xs text-muted-foreground">{data.description}</p>
          )}
        </div>
      </div>

      <Separator />

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-muted-foreground text-xs">Assets</p>
          <p className="font-medium">{data.asset_count ?? 0}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Role</p>
          <div className="flex gap-1 mt-1">
            {data.is_landing_zone && (
              <Badge variant="outline" className="text-xs">Input</Badge>
            )}
            {data.is_output_zone && (
              <Badge variant="outline" className="text-xs">Output</Badge>
            )}
            {!data.is_landing_zone && !data.is_output_zone && (
              <Badge variant="secondary" className="text-xs">Storage</Badge>
            )}
          </div>
        </div>
      </div>

      {data.has_active_source && (
        <div className="flex items-center gap-2 p-2 bg-green-50 dark:bg-green-950/20 rounded-md text-xs">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span>Receiving from active source</span>
        </div>
      )}

      <Separator />

      <Button 
        variant="outline" 
        className="w-full" 
        size="sm"
        onClick={() => onViewBundle?.(data.id)}
      >
        <ExternalLink className="h-4 w-4 mr-2" />
        View Assets
      </Button>
    </div>
  );

  const renderFlowPanel = () => (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Activity className={cn(
          "h-5 w-5",
          data.status === 'active' ? "text-green-600" :
          data.status === 'paused' ? "text-yellow-600" :
          data.status === 'error' ? "text-red-600" :
          "text-gray-600"
        )} />
        <div>
          <h3 className="font-semibold">{data.name}</h3>
          {data.description && (
            <p className="text-xs text-muted-foreground">{data.description}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Badge 
          variant={data.status === 'active' ? 'default' : 'secondary'}
        >
          {data.status}
        </Badge>
        {data.trigger_mode === 'on_arrival' && (
          <Badge variant="outline" className="text-xs">
            <Clock className="h-3 w-3 mr-1" />
            Auto-trigger
          </Badge>
        )}
      </div>

      <Separator />

      <div>
        <p className="text-xs font-medium text-muted-foreground mb-2">Pipeline Steps</p>
        <div className="space-y-1">
          {(data.steps || []).map((step: any, i: number) => (
            <div 
              key={i} 
              className="flex items-center gap-2 p-2 bg-muted/50 rounded text-xs"
            >
              <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center font-medium">
                {i + 1}
              </span>
              <span className="font-medium">{step.type}</span>
              {step.schema_ids && (
                <span className="text-muted-foreground">
                  ({step.schema_ids.length} schema{step.schema_ids.length !== 1 ? 's' : ''})
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      <Separator />

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-muted-foreground text-xs">Executions</p>
          <p className="font-medium">{data.total_executions ?? 0}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Assets Processed</p>
          <p className="font-medium">{data.total_assets_processed ?? 0}</p>
        </div>
      </div>

      <Separator />

      <div className="space-y-2">
        {data.status === 'active' ? (
          <Button 
            variant="outline" 
            className="w-full" 
            size="sm"
            onClick={() => onPauseFlow?.(data.id)}
          >
            <Pause className="h-4 w-4 mr-2" />
            Pause Flow
          </Button>
        ) : (
          <Button 
            variant="default" 
            className="w-full" 
            size="sm"
            onClick={() => onActivateFlow?.(data.id)}
          >
            <Play className="h-4 w-4 mr-2" />
            Activate Flow
          </Button>
        )}
        <Button 
          variant="outline" 
          className="w-full" 
          size="sm"
          onClick={() => onTriggerFlow?.(data.id)}
        >
          <Zap className="h-4 w-4 mr-2" />
          Run Now
        </Button>
        <Button 
          variant="ghost" 
          className="w-full text-destructive hover:text-destructive" 
          size="sm"
          onClick={() => {
            if (confirm('Are you sure you want to delete this flow?')) {
              onDeleteFlow?.(data.id);
            }
          }}
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Delete Flow
        </Button>
      </div>
    </div>
  );

  return (
    <div className="w-72 border-l bg-background flex flex-col h-full">
      <div className="p-3 border-b flex items-center justify-between">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Settings className="h-4 w-4" />
          Properties
        </h3>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1 p-3">
        {nodeType === 'source' && renderSourcePanel()}
        {nodeType === 'bundle' && renderBundlePanel()}
        {nodeType === 'flow' && renderFlowPanel()}
      </ScrollArea>
    </div>
  );
}
