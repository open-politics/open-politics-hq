'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Radio, Play, Loader2, ChevronUp, ChevronDown, Settings2, XCircle, Eye, ChevronRight, Microscope, Terminal, Minimize2, Activity, FolderOpen, ArrowRight } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { format } from 'date-fns';
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { AnnotationSchemaRead, BundleRead, AnnotationRunRead } from '@/client';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { useAnnotationSystem } from '@/hooks/useAnnotationSystem';
import { useBundleStore } from '@/zustand_stores/storeBundles';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { useProvidersStore } from '@/zustand_stores/storeProviders';
import { useSourceStore } from '@/zustand_stores/storeSources';
import ProviderSelector from '../management/ProviderSelector';
import AssetSelector from '../assets/AssetSelector';
import { SchemePreview } from '../annotation/schemaCreation/SchemePreview';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import AnnotationSchemaEditor from '../annotation/AnnotationSchemaEditor';
import { BundleActivityIndicators } from '../assets/BundleActivityIndicators';

interface MonitoringDockProps {
  allSchemes: AnnotationSchemaRead[];
  allRuns: AnnotationRunRead[];
  onCreateContinuousRun: (config: ContinuousRunConfig) => Promise<void>;
  onSelectRun: (runId: number) => void;
  activeRunId: number | null;
  isCreatingRun: boolean;
  onClearRun: () => void;
}

interface ContinuousRunConfig {
  bundleId: number;
  schemaIds: number[];
  name: string;
  description?: string;
  pollIntervalSeconds?: number;
  targetBundleId?: number;
  filterExpression?: any;
  promoteFragments?: {
    enabled: boolean;
    fields: string[];
    filter?: any;
  };
  configuration: Record<string, any>;
}

export default function MonitoringDock({
  allSchemes,
  allRuns,
  onCreateContinuousRun,
  onSelectRun,
  activeRunId,
  isCreatingRun,
  onClearRun,
}: MonitoringDockProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isMinimized, setIsMinimized] = useState(false);
  const [selectedBundleId, setSelectedBundleId] = useState<number | null>(null);
  const [selectedSchemeIds, setSelectedSchemeIds] = useState<Set<number>>(new Set());
  const [newRunName, setNewRunName] = useState<string>('');
  const [newRunDescription, setNewRunDescription] = useState<string>('');
  const [pollIntervalSeconds, setPollIntervalSeconds] = useState<number>(300);
  const [targetBundleId, setTargetBundleId] = useState<number | null>(null);
  const [promoteFragmentsEnabled, setPromoteFragmentsEnabled] = useState(false);
  const [promoteFields, setPromoteFields] = useState<string[]>([]);
  const [isPreviewDialogOpen, setIsPreviewDialogOpen] = useState(false);
  const [previewScheme, setPreviewScheme] = useState<AnnotationSchemaRead | null>(null);
  const [isSchemeEditorOpen, setIsSchemeEditorOpen] = useState(false);
  
  const { activeInfospace } = useInfospaceStore();
  const { bundles, fetchBundles } = useBundleStore();
  const { sources, fetchSources } = useSourceStore();
  const { loadSchemas: refreshSchemasFromHook } = useAnnotationSystem();
  const { apiKeys, selections } = useProvidersStore();
  const selectedProvider = selections.llm?.providerId || null;
  const selectedModel = selections.llm?.modelId || null;

  // Fetch bundles and sources on mount
  useEffect(() => {
    if (activeInfospace?.id) {
      fetchBundles(activeInfospace.id);
      fetchSources();
    }
  }, [activeInfospace?.id, fetchBundles, fetchSources]);

  // Find bundles that have active sources outputting to them
  const bundlesWithStreams = useMemo(() => {
    // Get bundle IDs that have active sources outputting to them
    const bundleIdsWithActiveSources = new Set<number>();
    
    sources.forEach(source => {
      // Check if source is active and has an output bundle
      if ((source as any).is_active === true && (source as any).output_bundle_id) {
        bundleIdsWithActiveSources.add((source as any).output_bundle_id);
      }
    });
    
    // Return bundles that match those IDs
    return bundles.filter(bundle => bundleIdsWithActiveSources.has(bundle.id));
  }, [bundles, sources]);

  // Filter continuous runs (runs with source_bundle_id)
  const continuousRuns = useMemo(() => {
    return allRuns.filter(run => (run as any).source_bundle_id != null);
  }, [allRuns]);

  const handleRunClick = useCallback(async () => {
    if (!selectedBundleId) {
      toast.error("Please select a bundle to monitor.");
      return;
    }
    if (selectedSchemeIds.size === 0) {
      toast.error("Please select at least one schema to use for annotation.");
      return;
    }
    if (!selectedProvider) {
      toast.error("Please configure an AI provider before running annotations.");
      return;
    }

    const config: ContinuousRunConfig = {
      bundleId: selectedBundleId,
      schemaIds: Array.from(selectedSchemeIds),
      name: newRunName || `Monitor - ${format(new Date(), 'yyyy-MM-dd HH:mm')}`,
      description: newRunDescription || undefined,
      pollIntervalSeconds,
      targetBundleId: targetBundleId || undefined,
      promoteFragments: promoteFragmentsEnabled ? {
        enabled: true,
        fields: promoteFields,
      } : undefined,
      configuration: {
        ai_provider: selectedProvider,
        ai_model: selectedModel,
        api_keys: apiKeys,
      },
    };

    await onCreateContinuousRun(config);
    setIsExpanded(false);
    setNewRunName('');
    setNewRunDescription('');
  }, [selectedBundleId, selectedSchemeIds, selectedProvider, selectedModel, apiKeys, newRunName, newRunDescription, pollIntervalSeconds, targetBundleId, promoteFragmentsEnabled, promoteFields, onCreateContinuousRun]);

  const handleSchemeToggle = (id: number) => {
    setSelectedSchemeIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const handlePreviewSchemeClick = (scheme: AnnotationSchemaRead) => {
    setPreviewScheme(scheme);
    setIsPreviewDialogOpen(true);
  };

  const handleCloseSchemeEditor = async () => {
    setIsSchemeEditorOpen(false);
    await refreshSchemasFromHook({ force: true });
  };

  const isAiConfigured = useMemo(() => {
    if (!selectedProvider) return false;
    if (selectedProvider === 'ollama') return true;
    return !!(apiKeys[selectedProvider]);
  }, [selectedProvider, apiKeys]);

  const selectedBundle = useMemo(() => {
    return bundles.find(b => b.id === selectedBundleId);
  }, [bundles, selectedBundleId]);

  // Get available fields for fragment promotion from selected schemas
  const availablePromoteFields = useMemo(() => {
    const fields: string[] = [];
    selectedSchemeIds.forEach(schemaId => {
      const schema = allSchemes.find(s => s.id === schemaId);
      if (schema?.output_contract && typeof schema.output_contract === 'object') {
        // Extract field keys from output contract
        const contract = schema.output_contract as Record<string, any>;
        Object.keys(contract).forEach(key => {
          if (!fields.includes(key)) {
            fields.push(key);
          }
        });
      }
    });
    return fields;
  }, [selectedSchemeIds, allSchemes]);

  return (
    <TooltipProvider>
      <div className={cn(
        "fixed flex flex-col bg-card/95 backdrop-blur-lg text-card-foreground shadow-2xl z-40 transition-all duration-300 ease-in-out rounded-md border",
        isMinimized 
          ? "bottom-4 right-4 w-12 h-12 shadow-2xl ring-1 ring-primary/20"
          : isExpanded 
            ? "bottom-4 left-1/2 transform -translate-x-1/2 w-[95vw] sm:w-auto sm:min-w-[500px] sm:max-w-[1500px] max-w-[95vw] shadow-lg hover:shadow-xl"
            : "bottom-4 left-1/2 transform -translate-x-1/2 w-12 h-12 sm:w-auto sm:h-auto sm:min-w-[400px] sm:max-w-[700px] shadow-2xl ring-1 ring-primary/20"
      )}>
        <div className="flex items-center justify-center sm:justify-between px-2 sm:px-4 py-0.5 cursor-pointer hover:bg-muted/30 transition-colors rounded-none" onClick={() => {
          if (isMinimized) {
            setIsMinimized(false);
          } else {
            setIsExpanded(!isExpanded);
          }
        }}>
          <div className={cn(
            "flex items-center justify-center w-full h-full",
            isMinimized ? "sm:flex" : "sm:hidden"
          )}>
            <div className="p-1.5 flex items-center justify-center rounded bg-orange-50/20 dark:bg-transparent border border-orange-200 dark:border-orange-800 shadow-sm">
              <Activity className="h-7 w-7 text-orange-700 dark:text-orange-400" />
            </div>
          </div>
          
          {!isMinimized && (
            <>
              <div className="hidden sm:flex items-center gap-3 flex-1 min-w-0 md:pt-1">
                <div className="p-2 flex items-center gap-2">
                  <Activity className="h-5 w-5 text-orange-700 dark:text-orange-400" />
                  <Radio className="h-5 w-5 text-orange-700 dark:text-orange-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">Monitoring</h3>
                  <p className="text-xs text-gray-600 dark:text-gray-400 truncate pb-1">
                    {isExpanded ? 'Configure continuous annotation on streams' : 'Click to expand'}
                  </p>
                </div>
                
                {activeRunId && (
                  <Badge variant="secondary" className="text-xs bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/20 dark:text-orange-400 dark:border-orange-800">
                    Run #{activeRunId}
                  </Badge>
                )}
              </div>
              
              <div className="hidden sm:flex items-center gap-2 py-0.5 pt-1">
                {activeRunId && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={(e) => { e.stopPropagation(); onClearRun(); }}
                    className="h-8 px-3 hover:bg-destructive/10 hover:text-destructive"
                  >
                    <XCircle className="h-3.5 w-3.5 mr-1.5" />
                    Clear
                  </Button>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8 p-0 hover:bg-muted/50" 
                      onClick={(e) => { e.stopPropagation(); setIsMinimized(true); }}
                    >
                      <Minimize2 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="text-xs">Minimize</p>
                  </TooltipContent>
                </Tooltip>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-8 w-8 p-0 hover:bg-muted/50" 
                  onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronUp className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </>
          )}
        </div>

        {isExpanded && !isMinimized && (
          <div className="p-3 sm:p-4 max-h-[70vh] sm:max-h-[75vh] overflow-y-auto">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
              <div className="space-y-3">
                {/* Basic Settings */}
                <div className="space-y-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="monitoring-run-name" className="text-xs font-medium">Run Name</Label>
                    <Input 
                      id="monitoring-run-name" 
                      placeholder="Enter a descriptive name..." 
                      value={newRunName} 
                      onChange={(e) => setNewRunName(e.target.value)}
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="monitoring-run-description" className="text-xs font-medium">Description</Label>
                    <Textarea 
                      id="monitoring-run-description" 
                      placeholder="Optional description..." 
                      value={newRunDescription} 
                      onChange={(e) => setNewRunDescription(e.target.value)}
                      className="min-h-[70px] resize-none text-sm"
                    />
                  </div>
                </div>

                {/* Bundle Selection */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Select Bundle to Monitor</Label>
                  <div className="border rounded-lg p-2 max-h-48 overflow-y-auto">
                    {bundlesWithStreams.length > 0 ? (
                      <div className="space-y-1">
                        {bundlesWithStreams.map(bundle => (
                          <div
                            key={bundle.id}
                            onClick={() => setSelectedBundleId(bundle.id)}
                            className={cn(
                              "p-2 rounded-md cursor-pointer transition-colors",
                              selectedBundleId === bundle.id 
                                ? "bg-primary/10 border border-primary" 
                                : "hover:bg-muted/50 border border-transparent"
                            )}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <FolderOpen className="h-4 w-4 flex-shrink-0" />
                                <span className="text-sm font-medium truncate">{bundle.name}</span>
                              </div>
                              {selectedBundleId === bundle.id && (
                                <Badge variant="outline" className="text-xs">Selected</Badge>
                              )}
                            </div>
                            {(() => {
                              // Count active sources for this bundle
                              const activeSourceCount = sources.filter(s => 
                                (s as any).is_active === true && 
                                (s as any).output_bundle_id === bundle.id
                              ).length;
                              
                              if (activeSourceCount > 0) {
                                return (
                                  <div className="mt-1 ml-6">
                                    <BundleActivityIndicators
                                      hasActiveSources={true}
                                      activeSourceCount={activeSourceCount}
                                    />
                                  </div>
                                );
                              }
                              return null;
                            })()}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground text-center p-4">
                        No bundles with active streams found. Create a stream source first.
                      </p>
                    )}
                  </div>
                </div>

                {/* Poll Interval */}
                {selectedBundleId && (
                  <div className="space-y-2">
                    <Label className="text-xs font-medium">Poll Interval (seconds)</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        value={pollIntervalSeconds}
                        onChange={(e) => setPollIntervalSeconds(parseInt(e.target.value) || 300)}
                        className="h-9"
                        min={60}
                      />
                      <div className="flex gap-1">
                        {[300, 900, 3600, 21600].map(interval => (
                          <Button
                            key={interval}
                            variant={pollIntervalSeconds === interval ? "default" : "outline"}
                            size="sm"
                            onClick={() => setPollIntervalSeconds(interval)}
                            className="text-xs h-9"
                          >
                            {interval === 300 ? '5m' : interval === 900 ? '15m' : interval === 3600 ? '1h' : '6h'}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Target Bundle (Routing) */}
                {selectedBundleId && (
                  <div className="space-y-2">
                    <Label className="text-xs font-medium">Route Filtered Results To (Optional)</Label>
                    <div className="border rounded-lg p-2 max-h-32 overflow-y-auto">
                      <div className="space-y-1">
                        {bundles.map(bundle => (
                          <div
                            key={bundle.id}
                            onClick={() => setTargetBundleId(bundle.id === targetBundleId ? null : bundle.id)}
                            className={cn(
                              "p-2 rounded-md cursor-pointer transition-colors",
                              targetBundleId === bundle.id 
                                ? "bg-primary/10 border border-primary" 
                                : "hover:bg-muted/50 border border-transparent"
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <FolderOpen className="h-3.5 w-3.5" />
                              <span className="text-xs truncate">{bundle.name}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Fragment Promotion */}
                {selectedBundleId && selectedSchemeIds.size > 0 && (
                  <div className="space-y-2 border rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium">Promote Fields to Metadata</Label>
                      <Switch
                        checked={promoteFragmentsEnabled}
                        onCheckedChange={setPromoteFragmentsEnabled}
                      />
                    </div>
                    {promoteFragmentsEnabled && availablePromoteFields.length > 0 && (
                      <div className="space-y-2 mt-2">
                        <Label className="text-xs text-muted-foreground">Select Fields to Promote</Label>
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                          {availablePromoteFields.map(field => (
                            <div key={field} className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                id={`promote-${field}`}
                                checked={promoteFields.includes(field)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setPromoteFields([...promoteFields, field]);
                                  } else {
                                    setPromoteFields(promoteFields.filter(f => f !== field));
                                  }
                                }}
                                className="h-3.5 w-3.5"
                              />
                              <Label htmlFor={`promote-${field}`} className="text-xs cursor-pointer">
                                {field}
                              </Label>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-col justify-end space-y-3">
                {/* Schema Selection */}
                <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/20 dark:bg-gray-950/10 space-y-2">
                  <h4 className="text-xs font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                    <Microscope className="w-3.5 h-3.5" />
                    Choose Annotation Schemas
                  </h4>
                  <ScrollArea className="max-h-48 overflow-y-auto scrollbar-hide">
                    <div className="space-y-1">
                      {allSchemes.map(scheme => (
                        <div key={scheme.id} className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50">
                          <input 
                            type="checkbox" 
                            id={`monitoring-scheme-${scheme.id}`} 
                            checked={selectedSchemeIds.has(scheme.id)} 
                            onChange={() => handleSchemeToggle(scheme.id)}
                            className="h-3.5 w-3.5"
                          />
                          <Label 
                            htmlFor={`monitoring-scheme-${scheme.id}`} 
                            className="flex-1 truncate cursor-pointer text-xs"
                          >
                            {scheme.name}
                          </Label>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-6 w-6" 
                            onClick={() => handlePreviewSchemeClick(scheme)}
                          >
                            <Eye className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                  <Button variant="ghost" size="sm" onClick={() => setIsSchemeEditorOpen(true)} className="w-full text-xs">
                    <Microscope className="h-3 w-3 mr-1" />
                    New Schema
                  </Button>
                </div>

                {/* AI Configuration */}
                <div className="space-y-2">
                  <ProviderSelector />
                  {selectedProvider && selectedProvider !== 'ollama' && !apiKeys[selectedProvider] && (
                    <div className="p-2 rounded-md bg-amber-50 border border-amber-200 dark:bg-amber-950/20 dark:border-amber-800">
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        Please configure API key for {selectedProvider}
                      </p>
                    </div>
                  )}
                </div>

                {/* Run Summary */}
                <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/20 dark:bg-gray-950/10 space-y-2">
                  <h4 className="text-xs font-medium text-gray-700 dark:text-gray-300">Run Summary</h4>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">Bundle</span>
                      <Badge variant="outline" className="text-xs">
                        {selectedBundle?.name || 'None'}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">Schemas</span>
                      <Badge variant="outline" className="text-xs">
                        {selectedSchemeIds.size}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">Poll Interval</span>
                      <Badge variant="outline" className="text-xs">
                        {pollIntervalSeconds}s
                      </Badge>
                    </div>
                    {targetBundleId && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium flex items-center gap-1">
                          <ArrowRight className="h-3 w-3" />
                          Routes To
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {bundles.find(b => b.id === targetBundleId)?.name}
                        </Badge>
                      </div>
                    )}
                    {promoteFragmentsEnabled && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">Fragment Promotion</span>
                        <Badge variant="outline" className="text-xs">
                          {promoteFields.length} fields
                        </Badge>
                      </div>
                    )}
                  </div>
                </div>

                <Button 
                  onClick={handleRunClick} 
                  disabled={isCreatingRun || !selectedBundleId || selectedSchemeIds.size === 0 || !isAiConfigured}
                  className="h-10 font-medium transition-all duration-200 disabled:opacity-50 text-sm"
                  size="lg"
                >
                  {isCreatingRun ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Creating Run...
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Create Continuous Run
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      <Dialog open={isPreviewDialogOpen} onOpenChange={setIsPreviewDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Schema Preview: {previewScheme?.name}</DialogTitle>
            <DialogDescription>
              Review the schema structure before running annotations.
            </DialogDescription>
          </DialogHeader>
          {previewScheme && (
            <div className="mt-4">
              <SchemePreview scheme={previewScheme} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPreviewDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AnnotationSchemaEditor show={isSchemeEditorOpen} onClose={handleCloseSchemeEditor} mode={'create'} defaultValues={null} />
    </TooltipProvider>
  );
}

