import React, { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { PanelRenderer } from '@/components/collection/infospaces/annotation/PanelRenderer';
import { FormattedAnnotation, AnnotationResultStatus } from '@/lib/annotations/types';
import { AnnotationSchemaRead, AssetRead, AssetKind } from '@/client/models';
import { PanelViewConfig } from '@/zustand_stores/useAnnotationRunStore';
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
  Lock
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

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
}

const SharedAnnotationRunDashboard: React.FC<SharedAnnotationRunDashboardProps> = ({ runData }) => {
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

  // Create default dashboard panels if views_config is not available
  const dashboardPanels = useMemo<PanelViewConfig[]>(() => {
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
        type: 'table',
        gridPos: { x: 0, y: 0, w: 12, h: 8 },
        filters: { logic: 'and', rules: [] },
        settings: {},
        collapsed: false,
      },
      {
        id: 'chart-panel',
        name: 'Results Over Time',
        description: 'Timeline view of annotation results',
        type: 'chart',
        gridPos: { x: 0, y: 8, w: 8, h: 6 },
        filters: { logic: 'and', rules: [] },
        settings: {
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
        type: 'pie',
        gridPos: { x: 8, y: 8, w: 4, h: 6 },
        filters: { logic: 'and', rules: [] },
        settings: {
          aggregateSources: true,
          selectedSourceIds: [],
        },
        collapsed: false,
      },
    ];
  }, [runData.views_config, formattedSchemas]);

  // No-op functions for read-only mode
  const handleUpdatePanel = () => {};
  const handleRemovePanel = () => {};

  return (
    <div className="min-h-screen py-8">
      <div className="container mx-auto px-4 max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 shadow-sm">
                <Play className="h-8 w-8 text-primary" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-foreground mb-2">{runData.name}</h1>
                {runData.description && (
                  <p className="text-lg text-muted-foreground">{runData.description}</p>
                )}
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="text-sm px-3 py-1">
                <Eye className="h-3 w-3 mr-1" />
                Read-only View
              </Badge>
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

        {/* Dashboard Grid */}
        <div 
          className="grid gap-6 auto-rows-[150px]"
          style={{ 
            gridTemplateColumns: `repeat(12, minmax(0, 1fr))`,
          }}
        >
          {dashboardPanels.map((panel) => (
            <div
              key={panel.id}
              className="transition-all duration-200 ease-in-out"
              style={{
                gridColumn: `span ${panel.gridPos.w}`,
                gridRow: `span ${panel.gridPos.h}`,
              }}
            >
              <PanelRenderer
                panel={panel}
                allResults={formattedResults}
                allSchemas={formattedSchemas}
                allSources={formattedSources}
                allAssets={formattedAssets}
                onUpdatePanel={handleUpdatePanel}
                onRemovePanel={handleRemovePanel}
              />
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-8 pt-6 border-t border-border/50">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4" />
              <span>This is a read-only view of a shared annotation run</span>
            </div>
            <div>
              <span>Run ID: {runData.id} | UUID: {runData.uuid}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SharedAnnotationRunDashboard; 