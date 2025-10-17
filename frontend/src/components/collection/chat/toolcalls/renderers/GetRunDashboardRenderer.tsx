/**
 * Get Run Dashboard Renderer
 * 
 * Renders annotation run dashboard with inline preview of actual panels
 */

import React, { useMemo } from 'react';
import { ToolResultRenderer } from '../core/ToolResultRegistry';
import { ToolResultRenderProps } from '../shared/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  CheckCircle2,
  Clock,
  Loader2,
  XCircle,
  AlertTriangle,
  ExternalLink,
  PlayCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { PanelRenderer } from '@/components/collection/annotation/PanelRenderer';
import type { FormattedAnnotation } from '@/lib/annotations/types';
import type { AnnotationSchemaRead } from '@/client';

interface AnnotationRunDashboardResult {
  run_id: number;
  run_name: string;
  run_uuid: string;
  status: string;
  created_at: string;
  updated_at?: string;
  completed_at?: string;
  annotation_count: number;
  annotations: Array<{
    id: number;
    asset_id: number;
    schema_id: number;
    value: Record<string, any>;
    status: string;
    timestamp?: string;
  }>;
  schemas: Array<{
    id: number;
    name: string;
    description?: string;
    output_contract?: any;
  }>;
  assets?: Array<{
    id: number;
    uuid: string;
    title: string;
    kind: string;
    infospace_id: number;
  }>;
  views_config?: any[];
  status_counts: Record<string, number>;
}

/**
 * Get status icon
 */
function getStatusIcon(status: string, className: string = 'h-5 w-5') {
  const iconClass = className;
  
  switch (status?.toLowerCase()) {
    case 'completed':
      return <CheckCircle2 className={cn(iconClass, 'text-green-600')} />;
    case 'running':
      return <Loader2 className={cn(iconClass, 'text-blue-600 animate-spin')} />;
    case 'failed':
      return <XCircle className={cn(iconClass, 'text-red-600')} />;
    case 'pending':
      return <Clock className={cn(iconClass, 'text-amber-600')} />;
    case 'completed_with_errors':
      return <AlertTriangle className={cn(iconClass, 'text-orange-600')} />;
    default:
      return <Clock className={cn(iconClass, 'text-gray-600')} />;
  }
}

/**
 * Get status color classes
 */
function getStatusColorClass(status: string): string {
  switch (status?.toLowerCase()) {
    case 'completed':
      return 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800';
    case 'running':
      return 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800';
    case 'failed':
      return 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800';
    case 'pending':
      return 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800';
    case 'completed_with_errors':
      return 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800';
    default:
      return 'bg-gray-50 dark:bg-gray-900/20 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-800';
  }
}

/**
 * Main renderer component
 */
function GetRunDashboardComponent({ result, compact }: ToolResultRenderProps) {
  const router = useRouter();
  const { activeInfospace } = useInfospaceStore();
  
  const runResult = result as AnnotationRunDashboardResult;
  
  // All hooks must be called before any conditional returns
  // Format annotations for PanelRenderer
  const formattedResults: FormattedAnnotation[] = useMemo(() => {
    return runResult.annotations.map((ann) => ({
      id: ann.id,
      asset_id: ann.asset_id,
      schema_id: ann.schema_id,
      run_id: runResult.run_id,
      value: ann.value,
      status: ann.status as any,
      timestamp: ann.timestamp || new Date().toISOString(),
      error_message: null,
    })) as FormattedAnnotation[];
  }, [runResult.annotations, runResult.run_id]);
  
  // Format schemas
  const formattedSchemas: AnnotationSchemaRead[] = useMemo(() => {
    return runResult.schemas.map((schema) => ({
      id: schema.id,
      uuid: schema.output_contract?.uuid || '',
      name: schema.name,
      description: schema.description || '',
      version: '1.0.0',
      output_contract: schema.output_contract,
      instructions: '',
      model_id: null,
      infospace_id: activeInfospace?.id || 0,
      user_id: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_active: true,
      field_specific_justification_configs: null,
    })) as AnnotationSchemaRead[];
  }, [runResult.schemas, activeInfospace?.id]);
  
  // Format assets
  const formattedAssets = useMemo(() => {
    return (runResult.assets || []).map((asset) => ({
      id: asset.id,
      uuid: asset.uuid,
      title: asset.title,
      kind: asset.kind as any,
      infospace_id: asset.infospace_id,
    }));
  }, [runResult.assets]);
  
  // Get first panel or create default table with all fields selected
  const panel = useMemo(() => {
    // Use existing panel if available
    if (runResult.views_config?.[0]?.panels?.[0]) {
      console.log('[GetRunDashboard] Using existing views_config:', runResult.views_config[0].panels[0]);
      return runResult.views_config[0].panels[0];
    }
    
    // Create default table configuration with all schema fields selected
    const selectedFields: Record<number, string[]> = {};
    
    console.log('[GetRunDashboard] Building default config from schemas:', formattedSchemas.map(s => ({
      id: s.id,
      name: s.name,
      hasContract: !!s.output_contract,
      hasProperties: !!s.output_contract?.properties,
      properties: s.output_contract?.properties ? Object.keys(s.output_contract.properties) : [],
    })));
    
    formattedSchemas.forEach(schema => {
      if (schema.output_contract?.properties) {
        // Select all root-level fields from each schema
        selectedFields[schema.id] = Object.keys(schema.output_contract.properties);
        console.log(`[GetRunDashboard] Selected fields for schema ${schema.id} (${schema.name}):`, selectedFields[schema.id]);
      } else {
        console.warn(`[GetRunDashboard] Schema ${schema.id} (${schema.name}) has no output_contract.properties`);
      }
    });
    
    console.log('[GetRunDashboard] Final selectedFields:', selectedFields);
    
    const panelConfig = {
      id: 'preview',
      type: 'table',
      name: 'Results',
      gridPos: { x: 0, y: 0, w: 12, h: 8 },
      settings: {
        selectedFields,
        showAssetTitle: true,
        showSchemaName: true,
        showStatus: true,
        showTimestamp: true,
      },
    };
    
    console.log('[GetRunDashboard] Created panel config:', panelConfig);
    
    return panelConfig;
  }, [runResult.views_config, formattedSchemas]);
  
  // Debug logging (after all hooks)
  console.log('[GetRunDashboard] Formatted data:', {
    results: formattedResults.length,
    schemas: formattedSchemas.length,
    assets: formattedAssets.length,
    views_config: runResult.views_config,
    firstResult: formattedResults[0],
    firstSchema: formattedSchemas[0],
  });
  
  // Navigate to full dashboard
  const handleViewDashboard = () => {
    router.push(`/hq/infospaces/annotation-runner`);
  };
  
  // Compact view (rendered after all hooks are declared)
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {getStatusIcon(runResult.status, 'h-4 w-4')}
        <span className="text-xs flex-1">{runResult.run_name}</span>
        <Badge variant="secondary" className="text-[10px] h-4 px-1">
          {runResult.annotation_count}
        </Badge>
      </div>
    );
  }
  
  return (
    <div className="space-y-2">
      {/* Compact header */}
      <div className="flex items-center justify-between gap-2 p-2 border-b">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <PlayCircle className="h-4 w-4 text-cyan-400 shrink-0" />
          <span className="text-sm font-medium truncate">{runResult.run_name}</span>
          <Badge variant="secondary" className="text-[10px] h-4 px-1">
            {runResult.annotation_count} results
          </Badge>
        </div>
        <Button
          onClick={handleViewDashboard}
          size="sm"
          variant="outline"
          className="h-7 px-2 text-[10px] shrink-0"
        >
          <ExternalLink className="h-3 w-3 mr-1" />
          Full
        </Button>
      </div>
      
      {/* Render actual dashboard panel */}
      <div className="border rounded-lg overflow-hidden bg-background">
        <div className="h-[800px]">
          <PanelRenderer
            panel={panel}
            allResults={formattedResults}
            allSchemas={formattedSchemas}
            allSources={[]}
            allAssets={formattedAssets}
            onUpdatePanel={() => {}}
            onRemovePanel={() => {}}
            onResultSelect={undefined}
            onRetrySingleResult={undefined}
            retryingResultId={undefined}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Renderer registration export
 */
export const GetRunDashboardRenderer: ToolResultRenderer = {
  toolName: 'get_run_dashboard',
  
  canHandle: (result: any) => {
    return result && (
      result.run_id !== undefined &&
      result.run_name !== undefined &&
      result.annotations !== undefined
    );
  },
  
  render: (props: ToolResultRenderProps) => {
    return <GetRunDashboardComponent {...props} />;
  },
  
  getSummary: (result: any) => {
    const typed = result as AnnotationRunDashboardResult;
    return `${typed.annotation_count} annotations • ${typed.status}`;
  }
};

