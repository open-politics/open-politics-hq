'use client';

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, Clock, AlertCircle, RefreshCw, Eye, ExternalLink, Play } from 'lucide-react';
import { cn } from "@/lib/utils";
import { AnnotationSchemaRead, AssetRead, AnnotationRead } from '@/client';
import { AnnotationsService } from '@/client';
import { adaptEnhancedAnnotationToFormattedAnnotation } from '@/lib/annotations/adapters';
import { FormattedAnnotation } from '@/lib/annotations/types';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { useBundleStore } from '@/zustand_stores/storeBundles';
import { formatDistanceToNowStrict } from 'date-fns';
import AnnotationResultDisplay from '../annotation/AnnotationResultDisplay';
import AssetLink from '../assets/Helper/AssetLink';
import { getAnnotationFieldValue } from '@/lib/annotations/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface MonitoringLiveResultsTableProps {
  runId: number; // Active run ID (for display purposes)
  sourceBundleId: number | null; // Bundle being monitored
  schemas: AnnotationSchemaRead[];
  runSchemaIds?: number[]; // Schema IDs configured for this specific run (fixes status calculation)
  allContinuousRunIds?: number[]; // All run IDs that monitor this bundle with same schemas (for aggregation)
  onResultSelect?: (result: FormattedAnnotation) => void;
  pollIntervalMs?: number; // How often to poll for updates (default: 3000ms)
  onTriggerAnnotation?: (assetIds: number[]) => Promise<void>; // Callback to trigger annotation for new assets
}

interface AssetWithStatus {
  asset: AssetRead;
  annotations: Map<number, FormattedAnnotation>; // Map schema_id -> annotation
  status: 'pending' | 'processing' | 'completed' | 'partial' | 'failed';
  lastUpdated: Date;
}

export function MonitoringLiveResultsTable({
  runId,
  sourceBundleId,
  schemas,
  runSchemaIds,
  allContinuousRunIds,
  onResultSelect,
  pollIntervalMs = 10000, // Poll every 10 seconds (reduced frequency to avoid race conditions)
  onTriggerAnnotation,
}: MonitoringLiveResultsTableProps) {
  const { activeInfospace } = useInfospaceStore();
  const { getBundleAssets } = useBundleStore();
  
  const [assetsWithStatus, setAssetsWithStatus] = useState<Map<number, AssetWithStatus>>(new Map());
  const [isPolling, setIsPolling] = useState(false);
  const [lastPollTime, setLastPollTime] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastAssetIdsRef = useRef<Set<number>>(new Set());
  const lastAnnotationIdsRef = useRef<Set<number>>(new Set());
  const processedAssetIdsRef = useRef<Set<number>>(new Set()); // Track assets that have been annotated
  const triggeringRef = useRef<boolean>(false); // Prevent duplicate trigger calls
  const [isTriggeringAnnotation, setIsTriggeringAnnotation] = useState(false);
  const [newAssetsCount, setNewAssetsCount] = useState(0);
  const [currentAssets, setCurrentAssets] = useState<AssetRead[]>([]);

  // Fetch assets from bundle
  const fetchBundleAssets = useCallback(async () => {
    if (!sourceBundleId || !activeInfospace?.id) return [];
    
    try {
      const assets = await getBundleAssets(sourceBundleId);
      return assets;
    } catch (err: any) {
      console.error('Failed to fetch bundle assets:', err);
      setError(`Failed to fetch assets: ${err.message}`);
      return [];
    }
  }, [sourceBundleId, activeInfospace?.id, getBundleAssets]);

  // Fetch annotations from all relevant continuous runs (aggregate across runs for same bundle/schemas)
  const fetchRunAnnotations = useCallback(async () => {
    if (!activeInfospace?.id) return [];
    
    try {
      // If allContinuousRunIds is provided, fetch from all those runs
      // Otherwise, fall back to just the active runId
      const runIdsToFetch = allContinuousRunIds && allContinuousRunIds.length > 0 
        ? allContinuousRunIds 
        : [runId];
      
      // Fetch annotations from all relevant runs in parallel
      const allAnnotationsPromises = runIdsToFetch.map(async (rid) => {
        try {
          const response = await AnnotationsService.getRunResults({
            infospaceId: activeInfospace.id,
            runId: rid,
            limit: 5000, // Get all annotations
          });
          return response.map(r => adaptEnhancedAnnotationToFormattedAnnotation(r));
        } catch (err: any) {
          console.warn(`Failed to fetch annotations for run ${rid}:`, err);
          return [];
        }
      });
      
      const allAnnotationsArrays = await Promise.all(allAnnotationsPromises);
      const allAnnotations = allAnnotationsArrays.flat();
      
      // Deduplicate: if multiple runs have annotations for the same asset+schema,
      // prefer the one from the most recent run (higher run ID = newer)
      const annotationMap = new Map<string, FormattedAnnotation>();
      allAnnotations.forEach(ann => {
        const key = `${ann.asset_id}_${ann.schema_id}`;
        const existing = annotationMap.get(key);
        if (!existing || ann.run_id > existing.run_id) {
          annotationMap.set(key, ann);
        }
      });
      
      return Array.from(annotationMap.values());
    } catch (err: any) {
      console.error('Failed to fetch run annotations:', err);
      setError(`Failed to fetch annotations: ${err.message}`);
      return [];
    }
  }, [activeInfospace?.id, runId, allContinuousRunIds]);

  // Update assets with their annotation status
  const updateAssetsWithStatus = useCallback(async () => {
    setIsPolling(true);
    setError(null);
    
    try {
      const [assets, annotations] = await Promise.all([
        fetchBundleAssets(),
        fetchRunAnnotations(),
      ]);

      // Create annotation map: asset_id -> schema_id -> annotation
      const annotationMap = new Map<number, Map<number, FormattedAnnotation>>();
      annotations.forEach(ann => {
        if (!annotationMap.has(ann.asset_id)) {
          annotationMap.set(ann.asset_id, new Map());
        }
        annotationMap.get(ann.asset_id)!.set(ann.schema_id, ann);
      });

      // Update assets with status
      const newAssetsWithStatus = new Map<number, AssetWithStatus>();
      
      assets.forEach(asset => {
        const assetAnnotations = annotationMap.get(asset.id) || new Map();
        // Use run's configured schema IDs if provided, otherwise fall back to all schemas
        const expectedSchemaIds = runSchemaIds 
          ? new Set(runSchemaIds) 
          : new Set(schemas.map(s => s.id));
        const completedSchemaIds = new Set(assetAnnotations.keys());
        
        let status: AssetWithStatus['status'] = 'pending';
        
        if (assetAnnotations.size === 0) {
          status = 'pending';
        } else if (assetAnnotations.size === expectedSchemaIds.size) {
          // Check if all are successful
          const hasFailures = Array.from(assetAnnotations.values()).some(
            ann => ann.status === 'failure'
          );
          status = hasFailures ? 'failed' : 'completed';
        } else {
          // Partial completion
          const hasFailures = Array.from(assetAnnotations.values()).some(
            ann => ann.status === 'failure'
          );
          status = hasFailures ? 'failed' : 'partial';
        }
        
        // Check if asset is actively being processed (recent annotation updates)
        const recentAnnotations = Array.from(assetAnnotations.values()).filter(
          ann => {
            const annDate = new Date(ann.timestamp);
            const now = new Date();
            return (now.getTime() - annDate.getTime()) < 60000; // Within last minute
          }
        );
        
        if (recentAnnotations.length > 0 && status === 'partial') {
          status = 'processing';
        }

        newAssetsWithStatus.set(asset.id, {
          asset,
          annotations: assetAnnotations,
          status,
          lastUpdated: new Date(),
        });
      });

      setAssetsWithStatus(newAssetsWithStatus);
      setCurrentAssets(assets);
      setLastPollTime(new Date());
      
      // Track new assets and annotations for visual feedback
      const currentAssetIds = new Set(assets.map(a => a.id));
      const currentAnnotationIds = new Set(annotations.map(a => a.id));
      
      // Detect new unannotated assets
      const annotatedAssetIds = new Set(annotations.map(a => a.asset_id));
      const newUnannotatedAssets = assets.filter(asset => 
        !annotatedAssetIds.has(asset.id) && !processedAssetIdsRef.current.has(asset.id)
      );
      
      // Update processed assets (assets that have at least one annotation)
      annotatedAssetIds.forEach(id => processedAssetIdsRef.current.add(id));
      
      setNewAssetsCount(newUnannotatedAssets.length);
      
      // Note: Auto-trigger removed - continuous runs should handle new assets automatically
      // Manual trigger is available via the button in the UI
      
      lastAssetIdsRef.current = currentAssetIds;
      lastAnnotationIdsRef.current = currentAnnotationIds;
      
    } catch (err: any) {
      setError(err.message || 'Failed to update data');
    } finally {
      setIsPolling(false);
    }
  }, [fetchBundleAssets, fetchRunAnnotations, schemas, runSchemaIds]);

  // Initial load and polling setup
  useEffect(() => {
    if (!runId || !sourceBundleId || !activeInfospace?.id) return;

    // Initial load
    updateAssetsWithStatus();

    // Set up polling
    pollIntervalRef.current = setInterval(() => {
      updateAssetsWithStatus();
    }, pollIntervalMs);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [runId, sourceBundleId, activeInfospace?.id, pollIntervalMs, updateAssetsWithStatus]);

  // Sort assets by creation date (newest first)
  const sortedAssets = useMemo(() => {
    return Array.from(assetsWithStatus.values()).sort((a, b) => {
      const dateA = new Date(a.asset.created_at).getTime();
      const dateB = new Date(b.asset.created_at).getTime();
      return dateB - dateA; // Newest first
    });
  }, [assetsWithStatus]);

  const getStatusBadge = (status: AssetWithStatus['status']) => {
    switch (status) {
      case 'pending':
        return (
          <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-400">
            <Clock className="h-3 w-3 mr-1" />
            Pending
          </Badge>
        );
      case 'processing':
        return (
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            Processing
          </Badge>
        );
      case 'partial':
        return (
          <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/20 dark:text-orange-400">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            Partial
          </Badge>
        );
      case 'completed':
        return (
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Completed
          </Badge>
        );
      case 'failed':
        return (
          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400">
            <AlertCircle className="h-3 w-3 mr-1" />
            Failed
          </Badge>
        );
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header with polling status */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Live Results</h3>
          {isPolling && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
          {lastPollTime && (
            <span className="text-xs text-muted-foreground">
              Updated {formatDistanceToNowStrict(lastPollTime, { addSuffix: true })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {newAssetsCount > 0 && (
            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 text-xs">
              {newAssetsCount} new
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">
            {sortedAssets.length} asset{sortedAssets.length !== 1 ? 's' : ''}
          </span>
          {onTriggerAnnotation && newAssetsCount > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="default"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={async () => {
                      // Prevent duplicate triggers
                      if (triggeringRef.current || isTriggeringAnnotation) {
                        return;
                      }
                      
                      // Get all pending assets (those without annotations)
                      const unannotatedAssets = currentAssets
                        .filter(asset => {
                          const item = assetsWithStatus.get(asset.id);
                          return !item || item.status === 'pending';
                        })
                        .map(asset => asset.id);
                      
                      if (unannotatedAssets.length > 0 && onTriggerAnnotation) {
                        triggeringRef.current = true;
                        setIsTriggeringAnnotation(true);
                        try {
                          await onTriggerAnnotation(unannotatedAssets);
                          // Mark as processed
                          unannotatedAssets.forEach(id => processedAssetIdsRef.current.add(id));
                          // Refresh after triggering (with delay to allow backend to process)
                          setTimeout(() => {
                            updateAssetsWithStatus();
                          }, 2000);
                        } catch (err) {
                          console.error('Failed to trigger annotation:', err);
                          // Remove from processed if failed so user can retry
                          unannotatedAssets.forEach(id => processedAssetIdsRef.current.delete(id));
                        } finally {
                          setIsTriggeringAnnotation(false);
                          triggeringRef.current = false;
                        }
                      }
                    }}
                    disabled={isTriggeringAnnotation || isPolling}
                  >
                    {isTriggeringAnnotation ? (
                      <>
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        Triggering...
                      </>
                    ) : (
                      <>
                        <Play className="h-3 w-3 mr-1" />
                        {newAssetsCount > 0 ? `Process ${newAssetsCount} new` : 'Process pending'}
                      </>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">Manually trigger annotation for pending assets</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={updateAssetsWithStatus}
                  disabled={isPolling}
                >
                  <RefreshCw className={cn("h-3 w-3", isPolling && "animate-spin")} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Refresh now</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {error && (
        <div className="px-4 py-2 bg-destructive/10 text-destructive text-xs">
          {error}
        </div>
      )}

      {/* Live feed of assets */}
      <ScrollArea className="flex-1">
        <div className="space-y-2 p-4">
          {sortedAssets.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              {isPolling ? 'Loading assets...' : 'No assets found in bundle yet.'}
            </div>
          ) : (
            sortedAssets.map((item) => {
              const { asset, annotations, status } = item;
              const hasAnnotations = annotations.size > 0;
              
              return (
                <div
                  key={asset.id}
                  className={cn(
                    "border rounded-lg p-4 transition-all",
                    "hover:border-primary/50 hover:shadow-sm",
                    status === 'completed' && "bg-green-50/50 dark:bg-green-900/5 border-green-200 dark:border-green-800",
                    status === 'processing' && "bg-blue-50/50 dark:bg-blue-900/5 border-blue-200 dark:border-blue-800",
                    status === 'pending' && "bg-yellow-50/50 dark:bg-yellow-900/5 border-yellow-200 dark:border-yellow-800",
                    status === 'failed' && "bg-red-50/50 dark:bg-red-900/5 border-red-200 dark:border-red-800"
                  )}
                >
                  {/* Asset header */}
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <AssetLink assetId={asset.id} className="font-medium text-sm hover:text-primary">
                          {asset.title || `Asset #${asset.id}`}
                        </AssetLink>
                        {getStatusBadge(status)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Added {formatDistanceToNowStrict(new Date(asset.created_at), { addSuffix: true })}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {hasAnnotations && onResultSelect && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                onClick={() => {
                                  const firstAnnotation = Array.from(annotations.values())[0];
                                  if (firstAnnotation) {
                                    onResultSelect(firstAnnotation);
                                  }
                                }}
                              >
                                <Eye className="h-3 w-3" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs">View details</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                  </div>

                  {/* Annotations */}
                  {hasAnnotations ? (
                    <div className="space-y-2 mt-3 pt-3 border-t">
                      {/* Filter to only show schemas used in this run */}
                      {(runSchemaIds && runSchemaIds.length > 0 
                        ? schemas.filter(s => runSchemaIds.includes(s.id))
                        : schemas
                      ).map(schema => {
                        const annotation = annotations.get(schema.id);
                        
                        if (!annotation) {
                          return (
                            <div key={schema.id} className="text-xs text-muted-foreground/50 italic">
                              {schema.name}: <span className="text-yellow-600">Pending...</span>
                            </div>
                          );
                        }

                        const isFailed = annotation.status === 'failure';
                        
                        return (
                          <div
                            key={schema.id}
                            className={cn(
                              "text-xs",
                              isFailed && "text-red-600 dark:text-red-400"
                            )}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium">{schema.name}:</span>
                              {isFailed && (
                                <Badge variant="destructive" className="h-4 px-1 text-[10px]">
                                  Failed
                                </Badge>
                              )}
                            </div>
                            {!isFailed && (
                              <div className="ml-4 mt-1">
                                <AnnotationResultDisplay
                                  result={annotation}
                                  schema={schema}
                                  compact={true}
                                  renderContext="table"
                                  onResultSelect={onResultSelect}
                                  forceExpanded={false}
                                />
                              </div>
                            )}
                            {isFailed && (
                              <div className="ml-4 mt-1 text-xs text-muted-foreground">
                                {(annotation as any).error_message || 'Annotation failed'}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground/70 italic mt-2">
                      Waiting for annotations...
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export default MonitoringLiveResultsTable;

