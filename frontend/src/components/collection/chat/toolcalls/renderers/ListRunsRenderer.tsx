/**
 * List Runs Renderer
 * ==================
 * 
 * Minimal table display for annotation runs.
 * Shows run metadata in a clean tabular format.
 */

import React from 'react';
import { ToolResultRenderer } from '../core/ToolResultRegistry';
import { ToolResultRenderProps } from '../shared/types';
import { Badge } from '@/components/ui/badge';
import { 
  CheckCircle2, 
  Loader2, 
  XCircle, 
  Clock,
  AlertTriangle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { EmptyResult } from '../shared/ResultComponents';

interface RunItem {
  id: number;
  uuid: string;
  name: string;
  description?: string;
  status: string;
  target_asset_count: number;
  annotation_count: number;
  target_bundle_id?: number;
  schema_ids: number[];
  schema_names: string[];
  created_at: string;
  updated_at?: string;
  completed_at?: string;
}

interface ListRunsResult {
  runs: RunItem[];
  total: number;
  limit: number;
  offset: number;
  filters?: {
    schema_id?: number;
    status?: string;
  };
  message?: string;
  summary?: string;
}

/**
 * Get status icon and styling
 */
function getStatusDisplay(status: string) {
  switch (status) {
    case 'completed':
      return {
        icon: <CheckCircle2 className="h-3.5 w-3.5" />,
        color: 'text-green-600 dark:text-green-400',
        emoji: '✅'
      };
    case 'running':
      return {
        icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
        color: 'text-blue-600 dark:text-blue-400',
        emoji: '🔄'
      };
    case 'pending':
      return {
        icon: <Clock className="h-3.5 w-3.5" />,
        color: 'text-gray-500 dark:text-gray-400',
        emoji: '⏳'
      };
    case 'failed':
      return {
        icon: <XCircle className="h-3.5 w-3.5" />,
        color: 'text-red-600 dark:text-red-400',
        emoji: '❌'
      };
    case 'completed_with_errors':
      return {
        icon: <AlertTriangle className="h-3.5 w-3.5" />,
        color: 'text-yellow-600 dark:text-yellow-400',
        emoji: '⚠️'
      };
    default:
      return {
        icon: <Clock className="h-3.5 w-3.5" />,
        color: 'text-gray-500 dark:text-gray-400',
        emoji: '❓'
      };
  }
}

/**
 * Minimal table renderer for runs
 */
function RunsTable({ runs }: { runs: RunItem[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-2 px-3 font-medium text-muted-foreground w-12">ID</th>
            <th className="text-left py-2 px-3 font-medium text-muted-foreground">Name</th>
            <th className="text-left py-2 px-3 font-medium text-muted-foreground w-24">Status</th>
            <th className="text-left py-2 px-3 font-medium text-muted-foreground w-32">Results</th>
            <th className="text-left py-2 px-3 font-medium text-muted-foreground w-32">Created</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const statusDisplay = getStatusDisplay(run.status);
            
            return (
              <tr
                key={run.id}
                className="border-b border-border/30 hover:bg-accent/30 transition-colors"
              >
                {/* ID */}
                <td className="py-2 px-3 font-mono text-muted-foreground">
                  {run.id}
                </td>
                
                {/* Name + Schemas */}
                <td className="py-2 px-3 max-w-[300px]">
                  <div className="truncate font-medium" title={run.name}>
                    {run.name}
                  </div>
                  {run.schema_names && run.schema_names.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {run.schema_names.slice(0, 2).map((schema, idx) => (
                        <Badge
                          key={idx}
                          variant="outline"
                          className="text-[10px] h-4 px-1"
                        >
                          {schema}
                        </Badge>
                      ))}
                      {run.schema_names.length > 2 && (
                        <Badge variant="outline" className="text-[10px] h-4 px-1">
                          +{run.schema_names.length - 2}
                        </Badge>
                      )}
                    </div>
                  )}
                </td>
                
                {/* Status */}
                <td className="py-2 px-3">
                  <div className={cn("flex items-center gap-1.5", statusDisplay.color)}>
                    <span>{statusDisplay.emoji}</span>
                    <span className="capitalize">{run.status}</span>
                  </div>
                </td>
                
                {/* Results (Annotation count / Target count) */}
                <td className="py-2 px-3 text-muted-foreground">
                  {run.annotation_count > 0 ? (
                    <span>
                      <strong className="text-foreground">{run.annotation_count}</strong>
                      {' '}results
                      <span className="text-[10px] ml-1">
                        from {run.target_asset_count} assets
                      </span>
                    </span>
                  ) : (
                    <span>
                      {run.target_asset_count > 0 
                        ? `${run.target_asset_count} assets`
                        : run.target_bundle_id 
                          ? 'bundle'
                          : '0 assets'
                      }
                    </span>
                  )}
                </td>
                
                {/* Created date */}
                <td className="py-2 px-3 text-muted-foreground">
                  {new Date(run.created_at).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric'
                  })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Main List Runs Renderer
 */
export const ListRunsRenderer: ToolResultRenderer = {
  toolName: 'list_runs',
  
  canHandle: (result: any) => {
    return result?.runs !== undefined && Array.isArray(result.runs);
  },
  
  getSummary: (result: ListRunsResult) => {
    const total = result.total || result.runs?.length || 0;
    
    if (result.filters?.status) {
      return `${total} ${result.filters.status} runs`;
    }
    
    if (result.filters?.schema_id) {
      return `${total} runs (schema ${result.filters.schema_id})`;
    }
    
    return `${total} runs`;
  },
  
  render: ({ result, compact }: ToolResultRenderProps) => {
    const typedResult = result as ListRunsResult;
    const runs = typedResult.runs || [];
    
    if (runs.length === 0) {
      return (
        <div className="p-3">
          <EmptyResult 
            resource="annotation runs" 
            message="No annotation runs found" 
          />
        </div>
      );
    }
    
    // Compact mode - just show count
    if (compact) {
      return (
        <div className="flex items-center gap-2 px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            {runs.length} annotation run{runs.length !== 1 ? 's' : ''}
          </span>
          {typedResult.filters?.status && (
            <Badge variant="secondary" className="text-xs">
              {typedResult.filters.status}
            </Badge>
          )}
        </div>
      );
    }
    
    // Full mode - table
    return (
      <div className="space-y-2">
        {/* Header */}
        <div className="px-3 py-2 bg-muted/20 border-b flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">
              Annotation Runs ({runs.length})
            </span>
            {typedResult.filters?.status && (
              <Badge variant="secondary" className="text-xs">
                {typedResult.filters.status}
              </Badge>
            )}
            {typedResult.filters?.schema_id && (
              <Badge variant="secondary" className="text-xs">
                schema {typedResult.filters.schema_id}
              </Badge>
            )}
          </div>
        </div>
        
        {/* Table */}
        <RunsTable runs={runs} />
        
        {/* Footer hint */}
        {runs.length > 0 && (
          <div className="px-3 py-2 text-xs text-muted-foreground border-t">
            💡 Use <code className="px-1 py-0.5 bg-muted rounded text-[10px]">
              get_run_dashboard(run_id=X)
            </code> to see results
          </div>
        )}
      </div>
    );
  },
};

