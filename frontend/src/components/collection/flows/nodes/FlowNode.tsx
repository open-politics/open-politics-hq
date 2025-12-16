'use client';

import React, { memo, useState } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { 
  Activity, 
  Play, 
  Pause, 
  Zap,
  Filter, 
  Microscope, 
  Tag, 
  GitBranch, 
  Radio,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Clock
} from 'lucide-react';

const stepIcons: Record<string, React.ElementType> = {
  FILTER: Filter,
  ANNOTATE: Microscope,
  CURATE: Tag,
  ROUTE: GitBranch,
  EMBED: Zap,
  ANALYZE: Activity,
};

const stepColors: Record<string, string> = {
  FILTER: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-700',
  ANNOTATE: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700',
  CURATE: 'bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-900/30 dark:text-teal-300 dark:border-teal-700',
  ROUTE: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700',
  EMBED: 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-700',
  ANALYZE: 'bg-pink-100 text-pink-700 border-pink-200 dark:bg-pink-900/30 dark:text-pink-300 dark:border-pink-700',
};

const statusConfig: Record<string, { color: string; bgColor: string; borderColor: string }> = {
  draft: { 
    color: 'text-gray-600 dark:text-gray-400', 
    bgColor: 'bg-gray-50 dark:bg-gray-900',
    borderColor: 'border-gray-300 dark:border-gray-600'
  },
  active: { 
    color: 'text-green-600 dark:text-green-400', 
    bgColor: 'bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30',
    borderColor: 'border-green-400 dark:border-green-600'
  },
  paused: { 
    color: 'text-yellow-600 dark:text-yellow-400', 
    bgColor: 'bg-yellow-50 dark:bg-yellow-950/30',
    borderColor: 'border-yellow-400 dark:border-yellow-600'
  },
  error: { 
    color: 'text-red-600 dark:text-red-400', 
    bgColor: 'bg-red-50 dark:bg-red-950/30',
    borderColor: 'border-red-400 dark:border-red-600'
  },
};

interface FlowStep {
  type: string;
  schema_ids?: number[];
  expression?: Record<string, any>;
  fields?: string[];
  bundle_id?: number;
}

interface FlowNodeData {
  id: number;
  name: string;
  description?: string;
  status: string;
  trigger_mode: string;
  steps: FlowStep[];
  total_executions?: number;
  total_assets_processed?: number;
  last_execution_at?: string | null;
  onActivate?: (flowId: number) => void;
  onPause?: (flowId: number) => void;
  onTrigger?: (flowId: number) => void;
}

function StepChip({ step }: { step: FlowStep }) {
  const Icon = stepIcons[step.type] || Activity;
  const colorClass = stepColors[step.type] || stepColors.ANALYZE;
  
  return (
    <div className={cn(
      "flex items-center gap-1 px-2 py-1 rounded border text-[10px] font-medium",
      colorClass
    )}>
      <Icon className="h-3 w-3" />
      <span>{step.type}</span>
    </div>
  );
}

function FlowNode({ data, selected }: NodeProps<FlowNodeData>) {
  const [expanded, setExpanded] = useState(true);
  const status = statusConfig[data.status] || statusConfig.draft;
  const steps = data.steps || [];

  return (
    <div 
      className={cn(
        "min-w-[200px] max-w-[280px] rounded-lg border-2 shadow-sm transition-all",
        status.borderColor,
        status.bgColor,
        selected && "ring-2 ring-primary ring-offset-2",
        data.status === 'active' && "shadow-lg"
      )}
    >
      {/* Target Handle (input) */}
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className="!w-3 !h-3 !border-2 !border-violet-500 !bg-white dark:!bg-gray-900"
      />

      {/* Header */}
      <div className="px-3 py-2 border-b border-inherit flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <Activity className={cn("h-4 w-4 flex-shrink-0", status.color)} />
          <span className="font-medium text-sm truncate">{data.name}</span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <Badge 
            variant="outline" 
            className={cn("text-[10px] px-1.5 py-0", status.color)}
          >
            {data.status}
          </Badge>
          {data.trigger_mode === 'on_arrival' && (
            <Radio className="h-3 w-3 text-green-500" />
          )}
        </div>
      </div>

      {/* Steps Pipeline */}
      <div className="px-3 py-2">
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground w-full"
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          <span>{steps.length} step{steps.length !== 1 ? 's' : ''}</span>
        </button>
        
        {expanded && steps.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {steps.map((step, i) => (
              <React.Fragment key={i}>
                <StepChip step={step} />
                {i < steps.length - 1 && (
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                )}
              </React.Fragment>
            ))}
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="px-3 py-2 border-t border-inherit text-xs text-muted-foreground flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span>{data.total_executions ?? 0} runs</span>
          <span>•</span>
          <span>{data.total_assets_processed ?? 0} assets</span>
        </div>
        {data.last_execution_at && (
          <div className="flex items-center gap-1">
            <Clock className="h-2.5 w-2.5" />
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-2 py-1.5 border-t border-inherit flex items-center gap-1">
        {data.status === 'active' ? (
          <Button 
            size="sm" 
            variant="ghost"
            className="h-6 text-xs flex-1"
            onClick={(e) => { 
              e.stopPropagation(); 
              data.onPause?.(data.id); 
            }}
          >
            <Pause className="h-3 w-3 mr-1" />
            Pause
          </Button>
        ) : (
          <Button 
            size="sm" 
            variant="ghost"
            className="h-6 text-xs flex-1"
            onClick={(e) => { 
              e.stopPropagation(); 
              data.onActivate?.(data.id); 
            }}
          >
            <Play className="h-3 w-3 mr-1" />
            Activate
          </Button>
        )}
        <Button 
          size="sm" 
          variant="ghost"
          className="h-6 text-xs"
          onClick={(e) => { 
            e.stopPropagation(); 
            data.onTrigger?.(data.id); 
          }}
        >
          <Zap className="h-3 w-3" />
        </Button>
      </div>

      {/* Source Handle (output) */}
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className="!w-3 !h-3 !border-2 !border-violet-500 !bg-white dark:!bg-gray-900"
      />
    </div>
  );
}

export default memo(FlowNode);
