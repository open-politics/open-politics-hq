/**
 * Get Run Dashboard Renderer
 *
 * `analysis_hub(run.dashboard)` opens the run on the Annotation Runner (the operator
 * navigates there) and returns its results to the model. The dashboard itself renders
 * on that page — so the chat only shows a small confirmation, not an inline dashboard.
 */

import React from 'react';
import { ToolResultRenderer } from '../core/ToolResultRegistry';
import { ToolResultRenderProps } from '../shared/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Clock, Loader2, XCircle, AlertTriangle, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';

interface AnnotationRunDashboardResult {
  run_id: number;
  run_name: string;
  status: string;
  annotation_count: number;
  status_counts?: Record<string, number>;
}

function getStatusIcon(status: string, className: string = 'h-4 w-4') {
  switch (status?.toLowerCase()) {
    case 'completed':
      return <CheckCircle2 className={cn(className, 'text-green-600')} />;
    case 'running':
      return <Loader2 className={cn(className, 'text-blue-600 animate-spin')} />;
    case 'failed':
      return <XCircle className={cn(className, 'text-red-600')} />;
    case 'pending':
      return <Clock className={cn(className, 'text-amber-600')} />;
    case 'completed_with_errors':
      return <AlertTriangle className={cn(className, 'text-orange-600')} />;
    default:
      return <Clock className={cn(className, 'text-muted-foreground')} />;
  }
}

function GetRunDashboardComponent({ result, compact }: ToolResultRenderProps) {
  const router = useRouter();
  const runResult = result as AnnotationRunDashboardResult;

  const openRunner = () => router.push(`/hq/infospaces/annotation-runner?runId=${runResult.run_id}`);

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {getStatusIcon(runResult.status)}
        <span className="text-xs flex-1 truncate">{runResult.run_name}</span>
        <Badge variant="secondary" className="text-[10px] h-4 px-1">{runResult.annotation_count}</Badge>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm">
      {getStatusIcon(runResult.status)}
      <span className="flex-1 truncate">
        Opened run <strong>{runResult.run_name}</strong>
        <span className="text-xs text-muted-foreground"> · {runResult.annotation_count} results · {runResult.status}</span>
      </span>
      <Button onClick={openRunner} size="sm" variant="ghost" className="h-7 shrink-0 px-2 text-xs">
        <ExternalLink className="mr-1 h-3 w-3" /> Open
      </Button>
    </div>
  );
}

export const GetRunDashboardRenderer: ToolResultRenderer = {
  toolName: 'get_run_dashboard',

  canHandle: (result: any) => {
    return result
      && result.run_id !== undefined
      && result.run_name !== undefined
      && result.annotations !== undefined;
  },

  render: (props: ToolResultRenderProps) => {
    return <GetRunDashboardComponent {...props} />;
  },

  getSummary: (result: any) => {
    const typed = result as AnnotationRunDashboardResult;
    return `opened run ${typed.run_name ?? `#${typed.run_id}`}`;
  },
};
