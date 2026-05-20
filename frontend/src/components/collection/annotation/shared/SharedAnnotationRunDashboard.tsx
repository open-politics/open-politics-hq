import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { PanelRenderer } from '@/components/collection/annotation/PanelRenderer';
import { FormattedAnnotation, AnnotationResultStatus } from '@/lib/annotations/types';
import { AnnotationSchemaRead, AssetRead, AssetKind } from '@/client';
import { PanelViewConfig } from '@/zustand_stores/useAnnotationRunStore';
import type { PanelConfig } from '@/lib/annotations/types';
import { 
  Calendar, 
  Clock, 
  Play, 
  CheckCircle, 
  XCircle, 
  Loader2, 
  AlertTriangle,
  BarChart3,
  Target,
  Eye,
  Lock,
  Import,
  RotateCcw
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useParams, useRouter } from 'next/navigation';
import { useShareableStore } from '@/zustand_stores/storeShareables';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { toast } from 'sonner';
import { ImportResourceDialog } from '@/components/collection/assets/Helper/ImportResourceDialog';
import useAuth from '@/hooks/useAuth';
import AssetDetailProvider from '@/components/collection/assets/Views/AssetDetailProvider';

interface AnnotationRunPreview {
  id: number;
  uuid: string;
  name: string;
  description?: string;
  status: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  views_config?: Array<any>;
  configuration: Record<string, any>;
  annotation_count: number;
  target_schemas: Array<{
    id: number;
    uuid: string;
    name: string;
    description?: string;
    version: string;
    output_contract: Record<string, any>;
    instructions?: string;
  }>;
  annotations: Array<{
    id: number;
    uuid: string;
    value: Record<string, any>;
    status: string;
    timestamp?: string;
    created_at: string;
    asset?: {
      id: number;
      uuid?: string;
      title: string;
      kind: string;
    };
    schema?: {
      id: number;
      name: string;
      version: string;
    };
  }>;
}

interface SharedAnnotationRunDashboardProps {
  runData: AnnotationRunPreview;
  token?: string; // Optional share token for import functionality
}

const SharedAnnotationRunDashboard: React.FC<SharedAnnotationRunDashboardProps> = ({ runData, token: tokenProp }) => {
  const params = useParams();
  const router = useRouter();
  const token = tokenProp || (params?.token as string | undefined);
  const { importResourceFromToken } = useShareableStore();
  const activeInfospaceId = useInfospaceStore((state) => state.activeInfospace?.id);
  const { user } = useAuth();
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const getStatusIcon = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'running':
        return <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-600" />;
      case 'pending':
        return <Clock className="h-4 w-4 text-amber-600" />;
      case 'completed_with_errors':
        return <AlertTriangle className="h-4 w-4 text-orange-600" />;
      default:
        return <Clock className="h-4 w-4 text-gray-600" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'completed':
        return 'bg-green-100 text-green-800 border-green-300';
      case 'running':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'failed':
        return 'bg-red-100 text-red-800 border-red-300';
      case 'pending':
        return 'bg-amber-100 text-amber-800 border-amber-300';
      case 'completed_with_errors':
        return 'bg-orange-100 text-orange-800 border-orange-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  // Convert annotation run data to format expected by PanelRenderer
  const formattedResults = useMemo<FormattedAnnotation[]>(() => {
    return runData.annotations.map(annotation => ({
      id: annotation.id,
      uuid: annotation.uuid,
      asset_id: annotation.asset?.id || 0,
      schema_id: annotation.schema?.id || 0,
      run_id: runData.id,
      value: annotation.value,
      status: annotation.status as AnnotationResultStatus,
      timestamp: annotation.timestamp || annotation.created_at,
      created_at: annotation.created_at,
      updated_at: annotation.created_at,
      asset: annotation.asset ? {
        id: annotation.asset.id,
        uuid: annotation.asset.uuid || '',
        title: annotation.asset.title,
        kind: annotation.asset.kind,
        text_content: '',
        created_at: annotation.created_at,
      } : null,
      schema: annotation.schema ? {
        id: annotation.schema.id,
        name: annotation.schema.name,
        version: annotation.schema.version,
      } : undefined,
    })) as FormattedAnnotation[];
  }, [runData]);

  // Convert target schemas to format expected by PanelRenderer
  const formattedSchemas = useMemo<AnnotationSchemaRead[]>(() => {
    return runData.target_schemas.map(schema => ({
      id: schema.id,
      uuid: schema.uuid,
      name: schema.name,
      description: schema.description,
      version: schema.version,
      output_contract: schema.output_contract,
      instructions: schema.instructions,
      target_level: 'asset' as any,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      user_id: 0,
      infospace_id: 0,
      is_active: true,
    }));
  }, [runData.target_schemas]);

  // Extract unique assets from annotations for the table
  const formattedAssets = useMemo<AssetRead[]>(() => {
    const uniqueAssets = new Map<number, AssetRead>();
    
    runData.annotations.forEach(annotation => {
      if (annotation.asset && annotation.asset.id) {
        const assetId = annotation.asset.id;
        if (!uniqueAssets.has(assetId)) {
          uniqueAssets.set(assetId, {
            id: annotation.asset.id,
            uuid: annotation.asset.uuid || '',
            title: annotation.asset.title || 'Untitled Asset',
            kind: (annotation.asset.kind as AssetKind) || 'text',
            text_content: '',
            created_at: annotation.created_at,
            updated_at: annotation.created_at,
            infospace_id: 0,
            user_id: 0,
            source_id: 0, // Reference the dummy source
            parent_asset_id: null,
            part_index: null,
            is_container: false,
          });
        }
      }
    });
    
    return Array.from(uniqueAssets.values());
  }, [runData.annotations]);

  // Create a minimal sources array (we don't have source data in shared view)
  const formattedSources = useMemo(() => {
    return [{
      id: 0,
      name: 'Shared Run Data'
    }];
  }, []);

  // Compute initial panels from shared config
  const initialPanels = useMemo<PanelConfig[]>(() => {
    if (runData.views_config && runData.views_config.length > 0) {
      const dashboardConfig = runData.views_config[0];
      const originalPanels = dashboardConfig.panels || [];
      
      console.log(`[Shared Dashboard] Processing ${originalPanels.length} panels from views_config`);
      console.log(`[Shared Dashboard] Available schemas:`, formattedSchemas.map(s => ({ id: s.id, name: s.name })));
      
      // Remap schema IDs in panel settings for shared/imported runs
      const remappedPanels = originalPanels.map(panel => {
        if (panel.type === 'pie') {
          console.log(`[Pie Chart Settings] Processing pie chart panel "${panel.name}" (${panel.id})`);
          console.log(`[Pie Chart Settings] Original settings:`, panel.settings);
          
          if (panel.settings?.selectedSchemaId) {
            const originalSchemaId = panel.settings.selectedSchemaId;
            const targetSchema = formattedSchemas.find(s => s.id === originalSchemaId);
            
            if (!targetSchema) {
              // Try to find a schema with the same name
              const schemaByName = formattedSchemas.find(s => 
                s.name.toLowerCase() === originalSchemaId.toString().toLowerCase() ||
                runData.target_schemas.some(ts => ts.id === originalSchemaId && ts.name === s.name)
              );
              
              if (schemaByName) {
                console.log(`[Pie Chart Settings] Auto-remapping schema ID ${originalSchemaId} -> ${schemaByName.id} for panel ${panel.id}`);
                
                return {
                  ...panel,
                  settings: {
                    ...panel.settings,
                    selectedSchemaId: schemaByName.id
                  }
                };
              } else {
                console.log(`[Pie Chart Settings] ⚠️ Could not find matching schema for ID ${originalSchemaId} in panel ${panel.id}`);
                
                // If we can't find a match, use the first available schema as fallback
                if (formattedSchemas.length > 0) {
                  console.log(`[Pie Chart Settings] Using fallback schema ${formattedSchemas[0].id} (${formattedSchemas[0].name}) for panel ${panel.id}`);
                  
                  return {
                    ...panel,
                    settings: {
                      ...panel.settings,
                      selectedSchemaId: formattedSchemas[0].id,
                      // Reset field selection since schema changed
                      selectedFieldKey: null
                    }
                  };
                }
              }
            } else {
              console.log(`[Pie Chart Settings] ✓ Schema ID ${originalSchemaId} found for panel ${panel.id}`);
            }
          } else {
            console.log(`[Pie Chart Settings] ⚠️ No selectedSchemaId found in panel ${panel.id} settings`);
          }
        }
        
        // Also handle map panel settings with schema IDs
        if (panel.type === 'map' && panel.settings) {
          const updatedSettings = { ...panel.settings };
          let hasMapChanges = false;
          
          // Check geocodeSource schema ID
          if (panel.settings.geocodeSource?.schemaId) {
            const originalSchemaId = panel.settings.geocodeSource.schemaId;
            const targetSchema = formattedSchemas.find(s => s.id === originalSchemaId);
            
            if (!targetSchema) {
              const schemaByName = formattedSchemas.find(s => 
                runData.target_schemas.some(ts => ts.id === originalSchemaId && ts.name === s.name)
              );
              
              if (schemaByName) {
                console.log(`[Map Panel Settings] Auto-remapping geocodeSource schema ID ${originalSchemaId} -> ${schemaByName.id} for panel ${panel.id}`);
                updatedSettings.geocodeSource = {
                  ...panel.settings.geocodeSource,
                  schemaId: schemaByName.id
                };
                hasMapChanges = true;
              } else {
                console.log(`[Map Panel Settings] ⚠️ Could not find matching schema for geocodeSource ID ${originalSchemaId} in panel ${panel.id}`);
              }
            }
          }
          
          // Check labelSource schema ID
          if (panel.settings.labelSource?.schemaId) {
            const originalSchemaId = panel.settings.labelSource.schemaId;
            const targetSchema = formattedSchemas.find(s => s.id === originalSchemaId);
            
            if (!targetSchema) {
              const schemaByName = formattedSchemas.find(s => 
                runData.target_schemas.some(ts => ts.id === originalSchemaId && ts.name === s.name)
              );
              
              if (schemaByName) {
                console.log(`[Map Panel Settings] Auto-remapping labelSource schema ID ${originalSchemaId} -> ${schemaByName.id} for panel ${panel.id}`);
                updatedSettings.labelSource = {
                  ...panel.settings.labelSource,
                  schemaId: schemaByName.id
                };
                hasMapChanges = true;
              } else {
                console.log(`[Map Panel Settings] ⚠️ Could not find matching schema for labelSource ID ${originalSchemaId} in panel ${panel.id}`);
              }
            }
          }
          
          if (hasMapChanges) {
            return {
              ...panel,
              settings: updatedSettings
            };
          }
        }
        
        return panel;
      });
      
      return remappedPanels;
    }
    
    // Create default panels
    return [
      {
        id: 'table-panel',
        name: 'Annotation Results',
        description: 'Detailed view of all annotation results',
        type: 'table' as const,
        grid_position: { x: 0, y: 0, w: 12, h: 8 },
        projection: { field_mappings: {}, explosion: null },
        aggregation: {},
        local_filters: { logic: 'and' as const, conditions: [] },
        incoming_scopes: [],
        merge_maps: [],
        settings:{},
        collapsed: false,
      },
      {
        id: 'chart-panel',
        name: 'Results Over Time',
        description: 'Timeline view of annotation results',
        type: 'chart' as const,
        grid_position: { x: 0, y: 8, w: 8, h: 6 },
        projection: { field_mappings: {}, explosion: null },
        aggregation: { interval: 'day' },
        local_filters: { logic: 'and' as const, conditions: [] },
        incoming_scopes: [],
        merge_maps: [],
        settings:{
          selectedTimeInterval: 'day',
          aggregateSources: true,
          selectedSourceIds: [],
        },
        collapsed: false,
      },
      {
        id: 'pie-panel',
        name: 'Results by Schema',
        description: 'Distribution of results across schemas',
        type: 'pie' as const,
        grid_position: { x: 8, y: 8, w: 4, h: 6 },
        projection: { field_mappings: {}, explosion: null },
        aggregation: { top_n: 10 },
        local_filters: { logic: 'and' as const, conditions: [] },
        incoming_scopes: [],
        merge_maps: [],
        settings:{
          aggregateSources: true,
          selectedSourceIds: [],
        },
        collapsed: false,
      },
    ];
  }, [runData.views_config, formattedSchemas, runData.target_schemas]);

  // Local state for editable dashboard panels (starts with shared config)
  const [dashboardPanels, setDashboardPanels] = useState<PanelConfig[]>(initialPanels);
  const [hasChanges, setHasChanges] = useState(false);

  // Update local panels when shared config changes
  useEffect(() => {
    setDashboardPanels(initialPanels);
    setHasChanges(false);
  }, [initialPanels]);

  // Panel update handler
  const handleUpdatePanel = useCallback((panelId: string, updates: Partial<PanelConfig>) => {
    setDashboardPanels(prevPanels => {
      const panelIndex = prevPanels.findIndex(p => p.id === panelId);
      if (panelIndex === -1) return prevPanels;

      const currentPanel = prevPanels[panelIndex];
      const updatedPanel: PanelConfig = {
        ...currentPanel,
        ...updates,
        grid_position: updates.grid_position
          ? {
              x: Math.max(0, Math.min(11, updates.grid_position.x ?? currentPanel.grid_position.x)),
              y: Math.max(0, updates.grid_position.y ?? currentPanel.grid_position.y),
              w: Math.max(1, Math.min(12, updates.grid_position.w ?? currentPanel.grid_position.w)),
              h: Math.max(1, updates.grid_position.h ?? currentPanel.grid_position.h),
            }
          : currentPanel.grid_position,
        settings: updates.settings
          ? { ...currentPanel.settings, ...updates.settings }
          : currentPanel.settings,
        local_filters: updates.local_filters
          ? { ...currentPanel.local_filters, ...updates.local_filters }
          : currentPanel.local_filters,
      };

      const newPanels = [...prevPanels];
      newPanels[panelIndex] = updatedPanel;
      setHasChanges(true);
      return newPanels;
    });
  }, []);

  // Panel remove handler
  const handleRemovePanel = useCallback((panelId: string) => {
    setDashboardPanels(prevPanels => {
      const filtered = prevPanels.filter(p => p.id !== panelId);
      setHasChanges(true);
      return filtered;
    });
  }, []);

  // Reset to shared config
  const handleResetToShared = useCallback(() => {
    setDashboardPanels(initialPanels);
    setHasChanges(false);
    toast.success('Dashboard reset to shared configuration');
  }, [initialPanels]);

  // Import handler
  const handleOpenImportDialog = useCallback(() => {
    if (!token) {
      toast.error('Share token not available');
      return;
    }
    setIsImportDialogOpen(true);
  }, [token]);

  const executeImport = useCallback(async (targetInfospaceId: number) => {
    if (!token) return;

    setIsImporting(true);
    try {
      const result = await importResourceFromToken(token, targetInfospaceId);

      if (result && result.imported_resource_id) {
        toast.success(`Successfully imported "${result.imported_resource_name}" into your Infospace.`);
        
        // Redirect to the imported run
        router.push(`/infospace/${targetInfospaceId}/annotations?runId=${result.imported_resource_id}`);
      } else {
        toast.error('Failed to import annotation run');
      }
    } catch (error) {
      console.error('Import error:', error);
      toast.error('An unexpected error occurred during import.');
    } finally {
      setIsImporting(false);
      setIsImportDialogOpen(false);
    }
  }, [token, importResourceFromToken, router]);

  return (
    <AssetDetailProvider
      annotationResults={formattedResults}
      schemas={formattedSchemas}
      activeRunId={runData.id}
    >
    <div className="min-h-screen py-8">
      <div className="container mx-auto px-4 max-w-full">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-md bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 shadow-sm">
                <Play className="h-8 w-8 text-primary" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-foreground mb-2">{runData.name}</h1>
                {runData.description && (
                  <p className="text-lg text-muted-foreground">{runData.description}</p>
                )}
              </div>
            </div>
            
            <div className="flex items-center gap-3 flex-wrap">
              {hasChanges && (
                <Badge variant="outline" className="text-sm px-3 py-1 border-amber-300 text-amber-700">
                  <div className="w-2 h-2 bg-amber-500 rounded-full mr-1.5 animate-pulse" />
                  Unsaved changes
                </Badge>
              )}
              <div className="flex items-center gap-2">
                {getStatusIcon(runData.status)}
                <Badge className={cn("text-sm px-4 py-2", getStatusColor(runData.status))}>
                  {runData.status.replace(/_/g, ' ')}
                </Badge>
              </div>
            </div>
          </div>

          {/* Run Metadata */}
          <div className="flex flex-wrap items-center gap-6 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              <span>Created {format(new Date(runData.created_at), 'PPp')}</span>
            </div>
            {runData.completed_at && (
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4" />
                <span>Completed {format(new Date(runData.completed_at), 'PPp')}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              <span>{runData.annotation_count} annotations</span>
            </div>
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4" />
              <span>{runData.target_schemas.length} schemas</span>
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="mb-6 flex items-center justify-between gap-4 p-4 bg-card rounded-lg border shadow-sm">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Eye className="h-4 w-4" />
            <span>Editable dashboard view - changes are local only</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetToShared}
              disabled={!hasChanges}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset to Shared Config
            </Button>
            {user && activeInfospaceId ? (
              <Button
                variant="default"
                size="sm"
                onClick={handleOpenImportDialog}
                disabled={isImporting}
              >
                {isImporting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Import className="h-4 w-4 mr-2" />
                    Import to my Infospace
                  </>
                )}
              </Button>
            ) : (
              <Button
                variant="default"
                size="sm"
                onClick={() => router.push(`/login?redirect=/share/${token}`)}
              >
                <Lock className="h-4 w-4 mr-2" />
                Log In to Import
              </Button>
            )}
          </div>
        </div>

        {/* Dashboard Grid */}
        <>
          <style jsx>{`
            @media (min-width: 768px) {
              .shared-dashboard-panel {
                grid-column: calc(var(--grid-x) + 1) / span var(--grid-w);
                grid-row: calc(var(--grid-y) + 1) / span var(--grid-h);
                height: calc(var(--grid-h) * 150px) !important;
                max-height: calc(var(--grid-h) * 150px) !important;
              }
            }
            @media (max-width: 767px) {
              .shared-dashboard-panel {
                grid-column: 1 !important;
                grid-row: auto !important;
                height: auto !important;
                max-height: 400px !important;
                min-height: 250px !important;
              }
            }
          `}</style>
          <div 
            className="grid grid-cols-1 md:grid-cols-12 gap-2 md:auto-rows-[150px]"
          >
            {dashboardPanels.map((panel) => (
              <div
                key={panel.id}
                data-panel-id={panel.id}
                className="shared-dashboard-panel transition-all duration-200 ease-in-out"
                style={{
                  // CSS custom properties for responsive behavior
                  '--grid-x': panel.grid_position.x,
                  '--grid-y': panel.grid_position.y,
                  '--grid-w': panel.grid_position.w,
                  '--grid-h': panel.grid_position.h,
                } as React.CSSProperties}
              >
              <PanelRenderer
                panel={panel as any}
                infospaceId={0}
                runId={runData.id}
                allSchemas={formattedSchemas}
                onUpdatePanel={handleUpdatePanel as any}
                onRemovePanel={handleRemovePanel}
                // Editable mode: allow filter/config changes but disable asset navigation
                // Assets don't exist in viewer's infospace, so navigation would fail
                onResultSelect={undefined}
                onRetrySingleResult={undefined}
                retryingResultId={undefined}
                // Cross-panel navigation for shared dashboards (read-only, just scrolls to panel)
                onTimestampClick={(timestamp, fieldKey, sourcePanelId) => {
                  const chartPanel = dashboardPanels.find(p => p.type === 'chart');
                  if (chartPanel) {
                    const panelElement = document.querySelector(`[data-panel-id="${chartPanel.id}"]`);
                    if (panelElement) {
                      panelElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      panelElement.classList.add('ring-2', 'ring-blue-500', 'ring-offset-2');
                      setTimeout(() => {
                        panelElement.classList.remove('ring-2', 'ring-blue-500', 'ring-offset-2');
                      }, 2000);
                    }
                  }
                }}
                onLocationClick={(location, fieldKey, sourcePanelId) => {
                  const mapPanel = dashboardPanels.find(p => p.type === 'map');
                  if (mapPanel) {
                    const panelElement = document.querySelector(`[data-panel-id="${mapPanel.id}"]`);
                    if (panelElement) {
                      panelElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      panelElement.classList.add('ring-2', 'ring-emerald-500', 'ring-offset-2');
                      setTimeout(() => {
                        panelElement.classList.remove('ring-2', 'ring-emerald-500', 'ring-offset-2');
                      }, 2000);
                    }
                  }
                }}
              />
              </div>
            ))}
          </div>
        </>

        {/* Footer */}
        <div className="mt-8 pt-6 border-t border-border/50">
          <div className="flex items-center justify-between text-sm text-muted-foreground flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4" />
              <span>Editable dashboard - changes are local and cannot be saved</span>
            </div>
            <div>
              <span>Run ID: {runData.id} | UUID: {runData.uuid}</span>
            </div>
          </div>
        </div>

        {/* Import Dialog */}
        {isImportDialogOpen && token && (
          <ImportResourceDialog
            isOpen={isImportDialogOpen}
            onClose={() => setIsImportDialogOpen(false)}
            onConfirm={executeImport}
            resourceName={runData.name}
            isImporting={isImporting}
          />
        )}
      </div>
    </div>
    </AssetDetailProvider>
  );
};

export default SharedAnnotationRunDashboard; 