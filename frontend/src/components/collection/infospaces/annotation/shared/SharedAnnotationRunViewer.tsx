import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Calendar, 
  Clock, 
  Play, 
  CheckCircle, 
  XCircle, 
  Loader2, 
  AlertTriangle,
  FileText,
  Settings,
  BarChart3,
  Database,
  Target
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

interface SharedAnnotationRunViewerProps {
  runData: AnnotationRunPreview;
}

const SharedAnnotationRunViewer: React.FC<SharedAnnotationRunViewerProps> = ({ runData }) => {
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

  // Group annotations by schema
  const annotationsBySchema = useMemo(() => {
    const grouped = new Map<number, typeof runData.annotations>();
    runData.annotations.forEach(annotation => {
      const schemaId = annotation.schema?.id;
      if (schemaId) {
        if (!grouped.has(schemaId)) {
          grouped.set(schemaId, []);
        }
        grouped.get(schemaId)!.push(annotation);
      }
    });
    return grouped;
  }, [runData.annotations]);

  // Group annotations by asset
  const annotationsByAsset = useMemo(() => {
    const grouped = new Map<number, typeof runData.annotations>();
    runData.annotations.forEach(annotation => {
      const assetId = annotation.asset?.id;
      if (assetId) {
        if (!grouped.has(assetId)) {
          grouped.set(assetId, []);
        }
        grouped.get(assetId)!.push(annotation);
      }
    });
    return grouped;
  }, [runData.annotations]);

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
              {getStatusIcon(runData.status)}
              <Badge className={cn("text-sm px-4 py-2", getStatusColor(runData.status))}>
                {runData.status.replace(/_/g, ' ')}
              </Badge>
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

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Main Content Area */}
          <div className="xl:col-span-2 space-y-6">
            {/* Annotation Results by Schema */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="h-5 w-5" />
                  Annotation Results by Schema
                </CardTitle>
                <CardDescription>
                  Results organized by annotation schema
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  {runData.target_schemas.map(schema => {
                    const schemaAnnotations = annotationsBySchema.get(schema.id) || [];
                    return (
                      <div key={schema.id} className="border rounded-lg p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-purple-100 border border-purple-200">
                              <Settings className="h-4 w-4 text-purple-600" />
                            </div>
                            <div>
                              <h3 className="font-semibold">{schema.name}</h3>
                              <p className="text-sm text-muted-foreground">v{schema.version}</p>
                            </div>
                          </div>
                          <Badge variant="outline">
                            {schemaAnnotations.length} results
                          </Badge>
                        </div>
                        
                        {schema.description && (
                          <p className="text-sm text-muted-foreground mb-3">{schema.description}</p>
                        )}

                        {schemaAnnotations.length > 0 ? (
                          <ScrollArea className="h-64 border rounded">
                            <div className="p-3 space-y-2">
                              {schemaAnnotations.slice(0, 20).map(annotation => (
                                <div key={annotation.id} className="border rounded p-3 bg-muted/30">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-medium">
                                      {annotation.asset?.title || `Asset ${annotation.asset?.id}`}
                                    </span>
                                    <Badge variant="outline" className="text-xs">
                                      {annotation.status}
                                    </Badge>
                                  </div>
                                  <div className="text-sm">
                                    <pre className="whitespace-pre-wrap text-xs bg-background p-2 rounded border">
                                      {JSON.stringify(annotation.value, null, 2)}
                                    </pre>
                                  </div>
                                </div>
                              ))}
                              {schemaAnnotations.length > 20 && (
                                <div className="text-center py-2 text-sm text-muted-foreground">
                                  ... and {schemaAnnotations.length - 20} more results
                                </div>
                              )}
                            </div>
                          </ScrollArea>
                        ) : (
                          <div className="text-center py-8 text-muted-foreground">
                            <FileText className="h-8 w-8 mx-auto mb-2" />
                            <p>No results for this schema</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Configuration */}
            <Card>
              <CardHeader>
                <CardTitle>Configuration</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {runData.configuration.target_asset_ids && (
                    <div>
                      <label className="text-sm font-medium">Target Assets</label>
                      <p className="text-sm text-muted-foreground">
                        {runData.configuration.target_asset_ids.length} assets
                      </p>
                    </div>
                  )}
                  {runData.configuration.target_bundle_id && (
                    <div>
                      <label className="text-sm font-medium">Target Bundle</label>
                      <p className="text-sm text-muted-foreground">
                        Bundle ID: {runData.configuration.target_bundle_id}
                      </p>
                    </div>
                  )}
                  
                  <Separator />
                  
                  <div className="text-xs">
                    <details>
                      <summary className="font-medium cursor-pointer">Raw Configuration</summary>
                      <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto">
                        {JSON.stringify(runData.configuration, null, 2)}
                      </pre>
                    </details>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Schemas */}
            <Card>
              <CardHeader>
                <CardTitle>Annotation Schemas</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {runData.target_schemas.map(schema => (
                    <div key={schema.id} className="border rounded p-3">
                      <div className="flex items-center gap-3 mb-2">
                        <Settings className="h-4 w-4 text-purple-600" />
                        <div>
                          <h4 className="font-medium text-sm">{schema.name}</h4>
                          <p className="text-xs text-muted-foreground">v{schema.version}</p>
                        </div>
                      </div>
                      {schema.description && (
                        <p className="text-xs text-muted-foreground mb-2">{schema.description}</p>
                      )}
                      {schema.instructions && (
                        <details className="text-xs">
                          <summary className="cursor-pointer font-medium">Instructions</summary>
                          <p className="mt-1 p-2 bg-muted rounded">{schema.instructions}</p>
                        </details>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Statistics */}
            <Card>
              <CardHeader>
                <CardTitle>Statistics</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-sm">Total Annotations</span>
                    <span className="font-medium">{runData.annotation_count}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Target Schemas</span>
                    <span className="font-medium">{runData.target_schemas.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Unique Assets</span>
                    <span className="font-medium">{annotationsByAsset.size}</span>
                  </div>
                  <Separator />
                  <div className="text-xs text-muted-foreground">
                    <p>Run ID: {runData.id}</p>
                    <p>UUID: {runData.uuid}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SharedAnnotationRunViewer; 